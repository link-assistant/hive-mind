/**
 * Minimal command runner used by the push/release helpers.
 *
 * Deliberately built on Node built-ins only: these helpers run in the release
 * job before (and after) `npm install`, and the push fallback must not depend
 * on node_modules state. Unlike command-stream's `$`, `runStrict` throws on a
 * non-zero exit code, restoring `set -e` semantics.
 */

import { spawn } from 'node:child_process';

/**
 * Error carrying the full result of a failed command so callers can classify
 * the failure (see push-failure-classifier.mjs) without parsing a message.
 */
export class CommandFailedError extends Error {
  /**
   * @param {string} command
   * @param {string[]} args
   * @param {{code: number, stdout?: string, stderr?: string}} result
   */
  constructor(command, args, result) {
    super(
      `Command failed (exit ${result.code}): ${command} ${args.join(' ')}\n${
        result.stderr || result.stdout || ''
      }`
    );
    this.name = 'CommandFailedError';
    this.command = command;
    this.args = args;
    this.code = result.code;
    this.stdout = result.stdout || '';
    this.stderr = result.stderr || '';
  }
}

/**
 * Run a command, capturing output while still streaming it to the log.
 * Never throws on a non-zero exit code; it resolves with the code instead.
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, env?: object, logger?: Console}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runCommand(command, args, options = {}) {
  const { cwd, env, logger = console } = options;
  logger.log(`$ ${command} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Run a command and throw a CommandFailedError when it exits non-zero.
 * @param {string} command
 * @param {string[]} args
 * @param {{runner?: Function, cwd?: string, env?: object, logger?: Console}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function runStrict(command, args, options = {}) {
  const { runner = runCommand, ...rest } = options;
  const result = await runner(command, args, rest);
  if (result.code !== 0) {
    throw new CommandFailedError(command, args, result);
  }
  return result;
}
