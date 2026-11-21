#!/usr/bin/env node
/**
 * Run one command, retrying it while it fails with a transient GitHub/network
 * fault - the shell-script face of `retryGitHubOperation` (issue #3552).
 *
 *   node scripts/github-retry.mjs gh release upload "$tag" "$@" --clobber
 *   node scripts/github-retry.mjs git fetch origin "$BASE_REF"
 *
 * The same classifier and policy as the JavaScript code decide what is a
 * GitHub operation and which failures are transient, so shell scripts and
 * workflow steps never grow their own retry loops or pattern lists. A command
 * that is not a GitHub operation runs exactly once.
 *
 * stdout is inherited untouched (so `$(...)` capture works); stderr is echoed
 * live and also kept, because the classifier can only recognise a fault it can
 * read. The exit code is the last attempt's.
 *
 * `HIVE_MIND_GITHUB_RETRY_DELAY_MS` overrides the first retry delay (tests).
 *
 * Dependency-free (Node built-ins and the leaf retry module), so it works in
 * workflow steps that run before `npm ci`.
 */

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { classifyGitHubCommand, retryGitHubOperation } from '../src/github-operation-retry.lib.mjs';

const runOnce = (command, args) =>
  new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      process.stderr.write(chunk);
      stderr += chunk;
    });
    child.on('error', error => resolve({ code: 127, stdout: '', stderr: `${stderr}${error.message}\n` }));
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 128 : 1), stdout: '', stderr }));
  });

/**
 * @param {string} command
 * @param {string[]} args
 * @param {object} [retryOptions] - forwarded to `retryGitHubOperation`.
 * @returns {Promise<number>} the exit code of the last attempt.
 */
export const runWithGitHubRetry = async (command, args, retryOptions = {}) => {
  const operation = classifyGitHubCommand(command, args);
  const run = () => runOnce(command, args);
  const result = operation ? await retryGitHubOperation(run, { label: operation.label, noun: operation.tool === 'git' ? 'git' : 'network', ...retryOptions }) : await run();
  return result.code;
};

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('Usage: node scripts/github-retry.mjs <command> [args...]');
    process.exit(2);
  }
  const delayMs = Number(process.env.HIVE_MIND_GITHUB_RETRY_DELAY_MS || NaN);
  process.exitCode = await runWithGitHubRetry(command, args, delayMs >= 0 ? { delayMs } : {});
}
