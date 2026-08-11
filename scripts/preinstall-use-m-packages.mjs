#!/usr/bin/env node

// Pre-install the pinned packages that src/ modules load via `use-m` at import
// time. Without this, every test file that imports those modules races on
// `npm install -g command-stream` and friends, which intermittently
// fails on GitHub-hosted runners with `ENOTEMPTY: directory not empty, rmdir`
// (see issue #1724, run 25109962685). use-m has no retry of its own.
//
// Once a package is installed at the latest version, use-m's
// ensurePackageInstalled returns early, so the test never touches `npm install`.

import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { USE_M_PACKAGE_VERSIONS } from '../src/use-with-retry.lib.mjs';

const execAsync = promisify(exec);

const PACKAGES = Object.entries(USE_M_PACKAGE_VERSIONS);

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const VERBOSE = process.env.PREINSTALL_USE_M_VERBOSE === '1' || process.env.RUNNER_DEBUG === '1';

const log = (message, ...rest) => {
  process.stdout.write(`[preinstall-use-m] ${message}\n`);
  if (rest.length) process.stdout.write(`${rest.join(' ')}\n`);
};
const debug = (message, ...rest) => {
  if (!VERBOSE) return;
  process.stdout.write(`[preinstall-use-m][debug] ${message}\n`);
  if (rest.length) process.stdout.write(`${rest.join(' ')}\n`);
};

export const aliasForPackage = (packageName, version = USE_M_PACKAGE_VERSIONS[packageName] ?? 'latest') => `${packageName.replace('@', '').replace('/', '-')}-v-${version}`;

export const isRetryableNpmError = error => {
  if (!error) return false;
  const haystack = `${error.stderr || ''}${error.stdout || ''}${error.message || ''}`;
  return /ENOTEMPTY|EBUSY|EPERM|ENOENT.*rmdir|ECONNRESET|ETIMEDOUT|EAI_AGAIN|429|503/i.test(haystack);
};

export const computeBackoffMs = (attempt, baseDelayMs = BASE_DELAY_MS) => baseDelayMs * 2 ** (attempt - 1);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const installWithRetry = async ({ packageName, version = USE_M_PACKAGE_VERSIONS[packageName] ?? 'latest', alias, globalRoot, runner = execAsync, attempts = MAX_ATTEMPTS, baseDelayMs = BASE_DELAY_MS, sleeper = sleep }) => {
  const specifier = `${packageName}@${version}`;
  const command = `npm install -g ${alias}@npm:${specifier}`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      debug(`attempt ${attempt}/${attempts}: ${command}`);
      await runner(command);
      log(`✅ installed ${specifier} as ${alias} (attempt ${attempt})`);
      return { ok: true, attempt };
    } catch (error) {
      const retryable = isRetryableNpmError(error);
      const installed = globalRoot && existsSync(join(globalRoot, alias, 'package.json'));
      log(`⚠️  attempt ${attempt}/${attempts} failed for ${packageName}: ${error.message?.split('\n')[0] || error}`);
      debug('stderr:', error.stderr || '(none)');
      debug('stdout:', error.stdout || '(none)');
      if (installed) {
        log(`ℹ️  ${alias} already present in ${globalRoot}; treating as success despite npm error`);
        return { ok: true, attempt, recovered: true };
      }
      if (!retryable || attempt === attempts) {
        log(`❌ giving up on ${specifier} after ${attempt} attempt(s)`);
        return { ok: false, attempt, error };
      }
      const delayMs = computeBackoffMs(attempt, baseDelayMs);
      debug(`retrying in ${delayMs}ms`);
      await sleeper(delayMs);
    }
  }
  return { ok: false, attempt: attempts };
};

const getNpmGlobalRoot = () => {
  try {
    return execSync('npm root -g', { encoding: 'utf8' }).trim();
  } catch (error) {
    log(`⚠️  could not determine npm global root: ${error.message}`);
    return '';
  }
};

const main = async () => {
  if (process.env.SKIP_PREINSTALL_USE_M === '1') {
    log('skipping (SKIP_PREINSTALL_USE_M=1)');
    return;
  }
  const globalRoot = getNpmGlobalRoot();
  log(`global root: ${globalRoot || '(unknown)'}`);
  const failures = [];
  for (const [packageName, version] of PACKAGES) {
    const alias = aliasForPackage(packageName, version);
    const result = await installWithRetry({ packageName, version, alias, globalRoot });
    if (!result.ok) failures.push({ packageName, error: result.error });
  }
  if (failures.length) {
    log(`❌ ${failures.length} package(s) failed: ${failures.map(f => f.packageName).join(', ')}`);
    process.exit(1);
  }
  log(`✅ all ${PACKAGES.length} pinned use-m packages pre-installed`);
};

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('preinstall-use-m-packages.mjs');
if (isMain) {
  main().catch(error => {
    log(`fatal: ${error.message}`);
    process.exit(1);
  });
}
