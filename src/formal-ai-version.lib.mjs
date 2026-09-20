#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Formal AI 0.326.1 fixed plans that were recorded but never executed and
 * 0.333.2 added the tool-result evidence fixes required by issues #2119/#2130.
 * 0.336.0 is the first release that answers formal-ai#982: `memory
 * upgrade-status`, `memory migrate --backup --receipt`, and the `/health`
 * memory compatibility block. Hive Mind now replaces the Formal AI container
 * while it is idle, so an unattended non-destructive memory upgrade is part of
 * the baseline rather than an optional extra.
 */
export const FORMAL_AI_MINIMUM_VERSION = '0.336.0';

/**
 * The first release exposing the persisted-memory upgrade contract. Kept
 * separate from {@link FORMAL_AI_MINIMUM_VERSION} so the container updater can
 * state precisely why a candidate image is refused even if the run-time floor
 * later moves for an unrelated reason.
 */
export const FORMAL_AI_MEMORY_CONTRACT_MINIMUM_VERSION = '0.336.0';

/**
 * The version baked into Hive Mind's images. Per the maintainer's review on
 * PR #2147 this is the *initial* pin only: once the container is running,
 * `src/formal-ai-updater.lib.mjs` replaces it with the newest published image
 * while no Formal AI task holds a lease. 0.339.0 restored `cargo install
 * formal-ai --locked` on stock Rust images (formal-ai#988) and 0.339.1 routed
 * command execution through the published command-stream component. 0.351.0 is
 * the current release and remains a safe bootstrap: its Cargo.lock carries no
 * `openssl-sys`, its rust-version matches the 1.98 builder, and its changes to
 * the memory-contract sources preserve the established CLI/health contract
 * while isolating test memory and sharing the existing SHA-256 helper. Verified
 * against the published crates; see docs/case-studies/issue-2186.
 */
export const FORMAL_AI_BOOTSTRAP_VERSION = '0.351.0';

export const parseFormalAiVersion = stdout => {
  const line = String(stdout || '')
    .split('\n')
    .map(entry => entry.trim())
    .find(Boolean);
  if (!line) return null;
  return line.replace(/^formal-ai\s+/i, '').trim() || null;
};

/** Read a Formal AI binary's version without allowing the probe to throw. */
export const readFormalAiBinaryVersion = async ({ formalAiPath = 'formal-ai', env = process.env, run = execFileAsync, timeoutMs = 30_000 } = {}) => {
  try {
    const result = await run(formalAiPath, ['--version'], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: timeoutMs });
    return parseFormalAiVersion(result?.stdout ?? result);
  } catch {
    return null;
  }
};

const parseComparableVersion = version => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(version || ''));
  if (!match) return null;
  return { core: match.slice(1, 4).map(Number), prerelease: match[4] || null };
};

export const isFormalAiVersionAtLeast = (version, minimumVersion) => {
  const candidate = parseComparableVersion(version);
  const minimum = parseComparableVersion(minimumVersion);
  if (!candidate || !minimum) return false;
  for (let index = 0; index < candidate.core.length; index += 1) {
    if (candidate.core[index] !== minimum.core[index]) return candidate.core[index] > minimum.core[index];
  }
  // A prerelease is lower than the stable release with the same numeric core.
  if (candidate.prerelease && !minimum.prerelease) return false;
  if (!candidate.prerelease && minimum.prerelease) return true;
  return !candidate.prerelease || candidate.prerelease >= minimum.prerelease;
};

/**
 * Issue #2247 (H1): the floor in the other direction.
 *
 * Hive Mind refuses a Formal AI older than {@link FORMAL_AI_MINIMUM_VERSION}.
 * The reverse had no expression at all: a Formal AI release that requires a
 * newer Hive Mind had no way to say so, and on 2026-09-13 three tasks ran
 * `solve v2.22.0` against a backend published after it, producing three
 * different failures and no version complaint anywhere.
 *
 * A serving backend states its requirement in `/health`; these are the field
 * names accepted for it, checked at the top level and inside a `requires` or
 * `hive_mind` object.
 */
export const HIVE_MIND_MINIMUM_VERSION_FIELDS = Object.freeze(['minimum_hive_mind_version', 'minimumHiveMindVersion', 'hive_mind_min_version', 'hiveMindMinVersion', 'hive_mind_minimum_version', 'min_version', 'minVersion']);

/** Operator override, for testing a floor before a backend publishes one. */
export const HIVE_MIND_MIN_VERSION_ENV = 'FORMAL_AI_HIVE_MIND_MIN_VERSION';

/**
 * Read the Hive Mind version a backend demands.
 *
 * @param {object|null} health - the parsed `/health` body
 * @param {object} [env]
 * @returns {string|null}
 */
export const readRequiredHiveMindVersion = (health = null, env = process.env) => {
  const fromEnv = String(env?.[HIVE_MIND_MIN_VERSION_ENV] || '').trim();
  if (fromEnv) return fromEnv;
  for (const source of [health, health?.requires, health?.hive_mind, health?.hiveMind]) {
    if (!source || typeof source !== 'object') continue;
    for (const field of HIVE_MIND_MINIMUM_VERSION_FIELDS) {
      const value = source[field];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
};

/**
 * Hive Mind's own version carries a build suffix in a git checkout
 * (`2.28.1.7ace68d4`), so only the numeric core is compared: a development
 * build of 2.28.1 satisfies a floor of 2.28.1.
 *
 * @returns {number[]|null}
 */
const parseVersionCore = version => {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version || '').trim());
  if (!match) return null;
  return [match[1], match[2], match[3]].map(part => (part === undefined ? 0 : Number(part)));
};

/**
 * @param {string} version
 * @param {string} minimumVersion
 * @returns {boolean}
 */
export const isHiveMindVersionAtLeast = (version, minimumVersion) => {
  const candidate = parseVersionCore(version);
  const minimum = parseVersionCore(minimumVersion);
  if (!candidate || !minimum) return false;
  for (let index = 0; index < 3; index += 1) {
    if (candidate[index] !== minimum[index]) return candidate[index] > minimum[index];
  }
  return true;
};

/**
 * Refuse to start a task whose Hive Mind is older than the serving backend
 * requires.
 *
 * Fail-closed, like every other Formal AI compatibility check (#2146): a
 * declared floor that cannot be evaluated - because this build cannot name its
 * own version - is a refusal, not a shrug. Nothing is refused when no backend
 * declares a floor, which is every deployment until one does.
 *
 * @param {object} params
 * @param {string|null} params.version - this Hive Mind's version
 * @param {string|null} params.required - the floor the backend published
 * @param {string} [params.where] - endpoint description for the message
 * @returns {string|null} the satisfied floor, or null when none was declared
 */
export const assertSupportedHiveMindVersion = ({ version, required, where = 'the Formal AI endpoint' } = {}) => {
  if (!required) return null;
  if (!parseVersionCore(required)) {
    throw new Error(`${where} requires Hive Mind >= ${required}, which is not a version Hive Mind can compare. Fix the backend's published minimum.`);
  }
  if (!version || version === 'unknown' || !parseVersionCore(version)) {
    throw new Error(`${where} requires Hive Mind >= ${required}, but this build cannot determine its own version. Refusing to start a task whose compatibility cannot be checked.`);
  }
  if (!isHiveMindVersionAtLeast(version, required)) {
    throw new Error(`${where} requires Hive Mind >= ${required}, but this task is running ${version}. Update the Hive Mind image before retrying; the running task image is stale (issue #2247).`);
  }
  return required;
};

/** Reject unknown and stale binaries before a model server or native CLI starts. */
export const assertSupportedFormalAiVersion = (version, minimumVersion = FORMAL_AI_MINIMUM_VERSION) => {
  if (!version) {
    throw new Error(`Could not determine the Formal AI version; Hive Mind requires Formal AI >= ${minimumVersion}. Check HIVE_MIND_FORMAL_AI_PATH and upgrade Formal AI.`);
  }
  if (!parseComparableVersion(version)) {
    throw new Error(`Hive Mind requires Formal AI >= ${minimumVersion}, but formal-ai --version returned an invalid version: ${version}`);
  }
  if (!isFormalAiVersionAtLeast(version, minimumVersion)) {
    throw new Error(`Hive Mind requires Formal AI >= ${minimumVersion}, found ${version}. Upgrade Formal AI before retrying.`);
  }
  return version;
};

export default {
  assertSupportedFormalAiVersion,
  assertSupportedHiveMindVersion,
  HIVE_MIND_MIN_VERSION_ENV,
  HIVE_MIND_MINIMUM_VERSION_FIELDS,
  isHiveMindVersionAtLeast,
  readRequiredHiveMindVersion,
  FORMAL_AI_BOOTSTRAP_VERSION,
  FORMAL_AI_MEMORY_CONTRACT_MINIMUM_VERSION,
  FORMAL_AI_MINIMUM_VERSION,
  isFormalAiVersionAtLeast,
  parseFormalAiVersion,
  readFormalAiBinaryVersion,
};
