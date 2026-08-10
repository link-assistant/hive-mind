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
 * while no Formal AI task holds a lease.
 */
export const FORMAL_AI_BOOTSTRAP_VERSION = '0.337.0';

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
  FORMAL_AI_BOOTSTRAP_VERSION,
  FORMAL_AI_MEMORY_CONTRACT_MINIMUM_VERSION,
  FORMAL_AI_MINIMUM_VERSION,
  isFormalAiVersionAtLeast,
  parseFormalAiVersion,
  readFormalAiBinaryVersion,
};
