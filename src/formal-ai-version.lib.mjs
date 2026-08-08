#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Formal AI 0.326.1 fixed plans that were recorded but never executed. The
 * later 0.333.2 release also contains the tool-result evidence fixes required
 * by issues #2119/#2130, so that is the supported baseline. Hive Mind retains
 * its explicit headless-client compatibility settings separately.
 */
export const FORMAL_AI_MINIMUM_VERSION = '0.333.2';

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

const isVersionAtLeast = (version, minimumVersion) => {
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
  if (!isVersionAtLeast(version, minimumVersion)) {
    throw new Error(`Hive Mind requires Formal AI >= ${minimumVersion}, found ${version}. Upgrade Formal AI before retrying.`);
  }
  return version;
};

export default {
  assertSupportedFormalAiVersion,
  FORMAL_AI_MINIMUM_VERSION,
  parseFormalAiVersion,
  readFormalAiBinaryVersion,
};
