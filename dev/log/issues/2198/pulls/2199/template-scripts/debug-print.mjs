#!/usr/bin/env node

/**
 * Lightweight debug logger for the pipeline scripts.
 *
 * When a dependency fails to load, a bare `$ is not a function` says nothing
 * about the module shape that produced it. This helper lets the scripts keep
 * such tracing in the code with the default state switched off, so an interop
 * regression stays readable from the CI log alone.
 *
 * Activation:
 *   - CI_SCRIPTS_DEBUG=1 (preferred local toggle), or
 *   - RUNNER_DEBUG=1 (GitHub "Re-run all jobs with debug logging"), or
 *   - ACTIONS_STEP_DEBUG=true (the secret-gated workflow debug switch).
 *
 * Every line is prefixed with `::debug::` so GitHub Actions renders it in the
 * collapsible debug stream, keeping the main log clean.
 *
 * Usage:
 *   import { debug } from './debug-print.mjs';
 *   debug('loaded command-stream', { keys });
 */

/**
 * Read one environment variable without ever throwing.
 *
 * Deno denies `process.env` access unless the run was granted `--allow-env`
 * (the Deno test job only passes `--allow-read`), and the denial surfaces as a
 * `NotCapable` error on the property read itself. Tracing must never be the
 * reason a script or a test fails, so an unreadable variable counts as unset.
 *
 * @param {string} name variable to read
 * @param {Record<string, string | undefined>} [env] explicit source, for tests
 * @returns {string | undefined}
 */
export function readEnvVar(name, env) {
  const source =
    env ?? (typeof process === 'undefined' ? undefined : process.env);
  if (!source) {
    return undefined;
  }
  try {
    return source[name];
  } catch {
    return undefined;
  }
}

/**
 * @param {Record<string, string | undefined>} [env] explicit source, for tests
 * @returns {boolean} true when debug output is enabled for this process
 */
export function isDebugEnabled(env) {
  const flag = readEnvVar('CI_SCRIPTS_DEBUG', env);
  return (
    flag === '1' ||
    flag === 'true' ||
    readEnvVar('RUNNER_DEBUG', env) === '1' ||
    readEnvVar('ACTIONS_STEP_DEBUG', env) === 'true'
  );
}

function format(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Render the lines `debug()` would print, without printing them.
 * @param {unknown[]} parts values to join into one message
 * @returns {string[]} `::debug::`-prefixed lines
 */
export function formatDebugLines(parts) {
  return parts
    .map(format)
    .join(' ')
    .split('\n')
    .map((chunk) => `::debug::${chunk}`);
}

/**
 * Print a debug line through injected collaborators, but only when debug
 * output is enabled. `debug()` is the production binding of this function.
 *
 * @param {{env?: Record<string, string | undefined>, log?: (line: string) => void}} options
 * @param {...unknown} parts values to join into one message
 * @returns {string[]} the lines printed, empty when debug output is off
 */
export function debugWith(options, ...parts) {
  const { env, log = console.log } = options ?? {};
  if (!isDebugEnabled(env)) {
    return [];
  }
  const lines = formatDebugLines(parts);
  for (const line of lines) {
    log(line);
  }
  return lines;
}

/**
 * Print a debug line, but only when debug output is enabled.
 * @param {...unknown} parts values to join into one message
 */
export function debug(...parts) {
  return debugWith({}, ...parts);
}
