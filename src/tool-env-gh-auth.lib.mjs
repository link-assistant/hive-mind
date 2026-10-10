/**
 * `gh` must work inside every AI tool session, with the exact environment the
 * tool process receives.
 *
 * Issue #2314: the Scala run (`--tool agent --model formal-ai`) relocated
 * `XDG_CONFIG_HOME` so the Agent CLI would read a generated config. `gh` honours
 * `XDG_CONFIG_HOME` too, so inside the session it no longer found
 * `~/.config/gh/hosts.yml`: the very first `gh issue view` printed "To get
 * started with GitHub CLI, please run: gh auth login" and the model gave up with
 * `planned_not_executed`. The Kotlin and Rust sessions, started minutes earlier
 * from the same container, used `gh` without trouble.
 *
 * Whatever a tool environment changes, `gh` keeps the operator's identity:
 * `GH_CONFIG_DIR` pins the config directory it had before, and `GH_TOKEN`
 * carries the token `gh auth token` resolves there. The environment is then
 * checked with `gh auth status` before the tool starts, so a broken setup fails
 * fast with a clear message instead of being discovered by the model.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2314
 */

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 30_000;

/** Names that must never be rendered into a logged command line. */
export const SECRET_TOOL_ENV_NAMES = Object.freeze(['GH_TOKEN', 'GITHUB_TOKEN']);

/** The directory `gh` reads in `env`: `GH_CONFIG_DIR`, else `$XDG_CONFIG_HOME/gh`, else `~/.config/gh`. */
export const resolveGhConfigDir = (env = process.env, realHome = homedir()) => env.GH_CONFIG_DIR?.trim() || join(env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || realHome, '.config'), 'gh');

/**
 * The variables that keep `gh` authenticated as the operator, resolved from the
 * environment solve itself runs with (before any tool-specific override).
 *
 * @param {Object} [params]
 * @param {Object} [params.env] - solve's own environment
 * @param {Function} [params.run] - `execFile`-like (file, args, options) => {stdout}
 * @returns {Promise<{GH_CONFIG_DIR: string, GH_TOKEN?: string}>}
 */
export const resolveGhAuthEnv = async ({ env = process.env, run = execFileAsync } = {}) => {
  const ghEnv = { GH_CONFIG_DIR: resolveGhConfigDir(env) };
  if (env.GH_TOKEN?.trim()) return { ...ghEnv, GH_TOKEN: env.GH_TOKEN.trim() };
  try {
    const { stdout } = await run('gh', ['auth', 'token'], { env, timeout: GH_TIMEOUT_MS });
    const token = String(stdout ?? '').trim();
    if (token) ghEnv.GH_TOKEN = token;
  } catch {
    // `gh auth status` below reports the problem with a usable message.
  }
  return ghEnv;
};

/**
 * Fail fast unless `gh auth status` succeeds with `toolEnv`.
 *
 * @param {Object} params
 * @param {Object} params.toolEnv - the complete environment the tool process gets
 * @param {string} [params.tool] - for the error message
 * @param {Function} [params.run]
 */
export const assertGhAuthenticatedInToolEnv = async ({ toolEnv, tool = 'the AI tool', run = execFileAsync }) => {
  try {
    await run('gh', ['auth', 'status'], { env: toolEnv, timeout: GH_TIMEOUT_MS });
  } catch (error) {
    // Only presence is reported: values read from the environment stay out of
    // error messages, which callers print as-is.
    const detail = String(error?.stderr || error?.stdout || error?.message || error)
      .trim()
      .split('\n')
      .slice(0, 5)
      .join(' | ');
    throw new Error(`gh is not authenticated in the environment ${tool} will run with (GH_CONFIG_DIR ${toolEnv?.GH_CONFIG_DIR ? 'set' : 'unset'}, GH_TOKEN ${toolEnv?.GH_TOKEN ? 'set' : 'unset'}): ${detail}`, { cause: error });
  }
};

/**
 * Resolve the `gh` variables for a tool environment and verify them.
 *
 * @param {Object} params
 * @param {Object} [params.env] - solve's own environment
 * @param {Object} [params.toolEnv] - variables the tool gets on top of `env`
 * @param {string} [params.tool]
 * @param {Function} [params.run]
 * @returns {Promise<Object>} the variables to add to the tool environment
 */
export const prepareToolGhAuth = async ({ env = process.env, toolEnv = {}, tool, run = execFileAsync } = {}) => {
  const ghEnv = await resolveGhAuthEnv({ env, run });
  await assertGhAuthenticatedInToolEnv({ toolEnv: { ...env, ...toolEnv, ...ghEnv }, tool, run });
  return ghEnv;
};

export default { SECRET_TOOL_ENV_NAMES, assertGhAuthenticatedInToolEnv, prepareToolGhAuth, resolveGhAuthEnv, resolveGhConfigDir };
