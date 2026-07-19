/**
 * Shared command runner for CI/CD scripts.
 *
 * Why this exists (issue #2082):
 *   Several CI scripts were converted from bash to .mjs in commit 5b7e60d7. The
 *   bash originals opened with `set -euo pipefail`, so any failing command
 *   aborted the job. The .mjs rewrites used command-stream's `$`, which does
 *   NOT throw on a non-zero exit code — it resolves with a result carrying
 *   `.code`. Scripts that never inspected `.code` therefore ignored every
 *   failure while still exiting 0, turning real breakage into green builds.
 *
 *   `scripts/helm-release.mjs` did exactly that and silently published nothing
 *   for ~7 months. `runStrict` below restores `set -e` semantics: a non-zero
 *   exit throws.
 *
 * Uses only Node built-ins so it has no dependency on node_modules state.
 */

import { spawn } from 'node:child_process';

/** Error thrown by {@link runStrict} when a command exits non-zero. */
export class CommandFailedError extends Error {
  constructor(command, args, result) {
    super(`Command failed with exit code ${result.code}: ${formatCommand(command, args)}`);
    this.name = 'CommandFailedError';
    this.command = command;
    this.args = args;
    this.code = result.code;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
  }
}

/**
 * Render a command for logs and error messages.
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
export function formatCommand(command, args = []) {
  return [command, ...args].join(' ');
}

/**
 * Whether verbose command tracing is enabled. Default is OFF; set
 * HIVE_MIND_CI_VERBOSE=1 (or `true`) to trace every command and exit code.
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function isVerbose(env = process.env) {
  const value = env.HIVE_MIND_CI_VERBOSE;
  return value === '1' || value === 'true';
}

/**
 * Run a command, streaming output to the parent stdio while buffering it so the
 * text can be inspected. Always resolves with the real exit code — never throws.
 *
 * Use this only when a non-zero exit is a legitimate outcome you intend to
 * branch on. Otherwise use {@link runStrict}.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{spawner?: typeof spawn, cwd?: string, env?: object, verbose?: boolean, logger?: Console}} [opts]
 * @returns {Promise<{code:number, stdout:string, stderr:string, message:string}>}
 */
export const runCommand = (command, args = [], { spawner = spawn, cwd, env, verbose = isVerbose(), logger = console } = {}) =>
  new Promise(resolve => {
    if (verbose) {
      logger.log(`[run] ${formatCommand(command, args)}${cwd ? ` (cwd: ${cwd})` : ''}`);
    }
    const child = spawner(command, args, { stdio: ['inherit', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}), ...(env ? { env } : {}) });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    const finish = result => {
      if (verbose) {
        logger.log(`[run] exit ${result.code}: ${formatCommand(command, args)}`);
      }
      resolve(result);
    };
    child.on('error', error => finish({ code: 1, stdout, stderr, message: error.message }));
    child.on('close', code => finish({ code: code ?? 1, stdout, stderr, message: '' }));
  });

/**
 * Run a command and throw {@link CommandFailedError} unless it exits 0.
 *
 * This is the `set -e` equivalent every CI script should default to.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{runner?: typeof runCommand} & Record<string, any>} [opts]
 * @returns {Promise<{code:number, stdout:string, stderr:string, message:string}>}
 */
export async function runStrict(command, args = [], { runner = runCommand, ...opts } = {}) {
  const result = await runner(command, args, opts);
  if (result.code !== 0) {
    throw new CommandFailedError(command, args, result);
  }
  return result;
}
