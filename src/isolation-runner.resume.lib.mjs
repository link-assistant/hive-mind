/**
 * `$ --resume` / `$ --resume-all` wrappers (start-command >= 0.33.0).
 *
 * Issue #2189 reported that a killed working session was only ever *offered*
 * for resume, and that when Hive Mind did resume one it had to start a fresh
 * isolated run — the container the work had happened in, with its clone, its
 * build cache and its half-finished branch, was thrown away. The missing
 * capability was filed upstream as link-foundation/start#162 and delivered in
 * `start-command@0.33.0`:
 *
 *   - `$ --resume <id> -- <command>` re-enters an existing execution. For a
 *     stopped docker session it commits the container filesystem and runs the
 *     new command in a container derived from that snapshot, so the workspace
 *     survives. The execution UUID is preserved, so `--status`, `--list` and
 *     `--upload-log` keep addressing one logical session across restarts.
 *   - `$ --resume-all` re-attaches a completion watcher to every execution
 *     still marked running and reconciles the ones that ended unsupervised. It
 *     never restarts work silently.
 *
 * Both are additive: a Hive Mind talking to an older `$` gets a clean
 * `unsupported` result and the caller falls back to its previous behaviour.
 * Neither wrapper throws.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-foundation/start/issues/162
 */

import { describeChildExit } from './child-exit.lib.mjs';
import { findStartCommandBinary, getCommandStreamDollar, START_COMMAND_MISSING_ERROR } from './start-command-cli.lib.mjs';

/** Strategies `$ --resume` can pick, mirroring upstream `ResumeMode`. */
export const RESUME_MODES = Object.freeze({
  DOCKER_START: 'docker-start',
  DOCKER_SNAPSHOT: 'docker-snapshot',
  RELAUNCH: 'relaunch',
});

/** Outcomes `$ --resume-all` reports per execution, mirroring `ResumeAllAction`. */
export const RESUME_ALL_ACTIONS = Object.freeze({
  REATTACHED: 'reattached',
  RUNNING: 'running',
  RECONCILED: 'reconciled',
  UNKNOWN: 'unknown',
});

/**
 * Does this `$` failure mean the verb does not exist yet?
 *
 * An older binary rejects the flag while parsing, long before it looks at the
 * store. Distinguishing that from a real refusal ("session is still running")
 * is what lets the caller degrade gracefully instead of reporting a bug.
 *
 * @param {string} message - stderr/message from the failed invocation
 * @returns {boolean}
 */
export function isUnsupportedStartCommandVerb(message) {
  const text = String(message || '').toLowerCase();
  // 0.32.1 answers `$ --resume-all` with `Error: Unknown wrapper option:
  // --resume-all` (verified against the pinned pre-0.33.0 binary), and other
  // argument parsers word it differently; match the family, not one string.
  return /unknown (\w+ )?(option|argument|flag)|unrecognized option|invalid option|no such option/.test(text);
}

/**
 * Parse the `executionResume` block `$ --resume --output-format json` prints.
 *
 * Tolerates links notation too (`executionResume` followed by indented
 * `key value` pairs), because an operator's `$` may default to it.
 *
 * @param {string} output - Raw stdout
 * @returns {{uuid: string|null, mode: string|null, backend: string|null, sessionName: string|null, previousSessionName: string|null, snapshotImage: string|null, command: string|null, message: string|null}}
 */
export function parseExecutionResumeOutput(output) {
  const empty = { uuid: null, mode: null, backend: null, sessionName: null, previousSessionName: null, snapshotImage: null, command: null, message: null };
  const raw = (output || '').trim();
  if (!raw) return empty;
  const str = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
  try {
    const parsed = JSON.parse(raw);
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
      uuid: str(data?.uuid),
      mode: str(data?.mode),
      backend: str(data?.backend),
      sessionName: str(data?.sessionName),
      previousSessionName: str(data?.previousSessionName),
      snapshotImage: str(data?.snapshotImage),
      command: str(data?.command),
      message: str(data?.message),
    };
  } catch {
    // Links notation — fall through.
  }
  // Links notation indents `key value`; `--output-format text` prints
  // `Label:   value`. The optional colon covers both with one expression.
  const readField = name => {
    const match = raw.match(new RegExp(`^\\s*${name}\\s*:?\\s+"?([^"\\n]+)"?\\s*$`, 'mi'));
    return str(match?.[1]);
  };
  return {
    uuid: readField('uuid'),
    mode: readField('mode') || readField('Resume Mode'),
    backend: readField('backend'),
    sessionName: readField('sessionName') || readField('Session Name'),
    previousSessionName: readField('previousSessionName'),
    snapshotImage: readField('snapshotImage'),
    command: readField('command'),
    message: readField('message'),
  };
}

/**
 * Parse the `executionResumeAll` block `$ --resume-all --output-format json`
 * prints. Anything unparseable yields an empty list rather than a throw — a
 * startup reconciliation must never be able to stop the bot from starting.
 *
 * @param {string} output - Raw stdout
 * @returns {Array<{uuid: string|null, backend: string|null, sessionName: string|null, state: string|null, action: string|null, exitCode: number|null, message: string|null}>}
 */
export function parseExecutionResumeAllOutput(output) {
  const raw = (output || '').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.executions) ? parsed.executions : [];
  const str = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return records
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const exitCode = entry.exitCode === null || entry.exitCode === undefined ? null : Number(entry.exitCode);
      return {
        uuid: str(entry.uuid),
        backend: str(entry.backend),
        sessionName: str(entry.sessionName),
        state: str(entry.state),
        action: str(entry.action),
        exitCode: Number.isFinite(exitCode) ? exitCode : null,
        message: str(entry.message),
      };
    })
    .filter(Boolean);
}

/**
 * Normalize what `command-stream`'s `$` hands back for one invocation.
 *
 * `$` does *not* throw on a non-zero exit — it resolves with `code` set (checked
 * against command-stream in experiments/issue-2189-start-command-resume.mjs).
 * Reading only the resolved value would therefore report every refusal
 * ("session is still running", "no execution found", "unknown wrapper option")
 * as a successful resume. Both shapes are folded into one verdict here.
 *
 * @param {object|null} result - Resolved value from `$`
 * @param {*} [error] - Rejection from `$`, when it threw instead
 * @returns {{ok: boolean, stdout: string, message: string|null, unsupported: boolean}}
 */
function interpretStartCommandResult(result, error = null) {
  const source = error || result || {};
  const stdout = source.stdout?.toString?.().trim() || '';
  const stderr = source.stderr?.toString?.().trim() || '';
  const code = error ? (Number.isFinite(source.code) ? source.code : 1) : Number.isFinite(source.code) ? source.code : 0;
  if (!error && code === 0) return { ok: true, stdout, message: null, unsupported: false };
  // describeChildExit is the repository's single vocabulary for "how a child
  // ended" (issue #2135); command-stream has already normalized a signalled
  // exit to 128+signum by this point, so the code is all there is to say.
  const message = stderr || source.message || describeChildExit({ command: 'start-command', code });
  return { ok: false, stdout, message, unsupported: isUnsupportedStartCommandVerb(`${message}\n${stdout}`) };
}

/**
 * Re-enter an existing execution via `$ --resume <identifier> [-- <command>]`.
 *
 * With a `command`, a stopped docker session is snapshotted and the command runs
 * against that snapshot, so the work already on disk is preserved — this is the
 * "re-enter the same container" half of issue #2189. Without one, the stored
 * command is re-run in place.
 *
 * The command is passed as a single argument after `--`, exactly like the launch
 * path does: start-command 0.33.0 preserves argv boundaries and runs a lone
 * argument verbatim as a shell script, so no quoting is lost.
 *
 * @param {string} identifier - Execution UUID or session name
 * @param {Object} [options]
 * @param {string|null} [options.command] - Command to run against the resumed session
 * @param {boolean} [options.verbose]
 * @returns {Promise<{success: boolean, unsupported: boolean, uuid: string|null, mode: string|null, backend: string|null, sessionName: string|null, previousSessionName: string|null, snapshotImage: string|null, message: string|null, output: string, error: string|null}>}
 */
export async function resumeIsolatedSession(identifier, { command = null, verbose = false } = {}) {
  const base = { success: false, unsupported: false, uuid: null, mode: null, backend: null, sessionName: null, previousSessionName: null, snapshotImage: null, message: null, output: '', error: null };
  if (!identifier) return { ...base, error: 'No execution identifier was given to resume.' };

  const binPath = await findStartCommandBinary();
  if (!binPath) {
    if (verbose) console.log('[VERBOSE] isolation-runner: cannot resume - $ binary not found');
    return { ...base, unsupported: true, error: START_COMMAND_MISSING_ERROR };
  }

  try {
    const $ = await getCommandStreamDollar();
    const raw = command ? await $({ mirror: false })`${binPath} --resume ${identifier} --output-format json -- ${command}` : await $({ mirror: false })`${binPath} --resume ${identifier} --output-format json`;
    const { ok, stdout, message, unsupported } = interpretStartCommandResult(raw);
    if (!ok) {
      if (verbose) console.log(`[VERBOSE] isolation-runner: $ --resume ${identifier} refused${unsupported ? ' (verb not supported by this $ build)' : ''}: ${message}`);
      return { ...base, unsupported, output: stdout, error: message };
    }
    const parsed = parseExecutionResumeOutput(stdout);
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: $ --resume ${identifier} → mode=${parsed.mode || '(unknown)'} session=${parsed.sessionName || '(unknown)'} uuid=${parsed.uuid || '(unknown)'}`);
    }
    return { ...base, ...parsed, success: true, output: stdout };
  } catch (error) {
    const { stdout, message, unsupported } = interpretStartCommandResult(null, error);
    if (verbose) console.log(`[VERBOSE] isolation-runner: $ --resume ${identifier} failed${unsupported ? ' (verb not supported by this $ build)' : ''}: ${message}`);
    return { ...base, unsupported, output: stdout, error: message };
  }
}

/**
 * Reconcile every execution still marked running via `$ --resume-all`.
 *
 * Run at bot startup: the detached-docker completion watchers are children of
 * the process that launched them, so a bot restart leaves every running
 * container unsupervised — its exit would never be written to the log footer,
 * which is one of the ways issue #2189's session stayed in limbo. `--resume-all`
 * re-attaches a watcher to what is alive and finalizes what died meanwhile. It
 * starts no work on its own.
 *
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{success: boolean, unsupported: boolean, executions: Array<Object>, output: string, error: string|null}>}
 */
export async function resumeAllIsolationSessions({ verbose = false } = {}) {
  const base = { success: false, unsupported: false, executions: [], output: '', error: null };
  const binPath = await findStartCommandBinary();
  if (!binPath) {
    if (verbose) console.log('[VERBOSE] isolation-runner: cannot run $ --resume-all - $ binary not found');
    return { ...base, unsupported: true, error: START_COMMAND_MISSING_ERROR };
  }

  try {
    const $ = await getCommandStreamDollar();
    const raw = await $({ mirror: false })`${binPath} --resume-all --output-format json`;
    const { ok, stdout, message, unsupported } = interpretStartCommandResult(raw);
    if (!ok) {
      if (verbose) console.log(`[VERBOSE] isolation-runner: $ --resume-all refused${unsupported ? ' (verb not supported by this $ build)' : ''}: ${message}`);
      return { ...base, unsupported, output: stdout, error: message };
    }
    const executions = parseExecutionResumeAllOutput(stdout);
    if (verbose) {
      const summary = executions.map(entry => `${entry.action}:${entry.sessionName || entry.uuid}`).join(', ') || '(none)';
      console.log(`[VERBOSE] isolation-runner: $ --resume-all reconciled ${executions.length} execution(s): ${summary}`);
    }
    return { ...base, success: true, executions, output: stdout };
  } catch (error) {
    const { stdout, message, unsupported } = interpretStartCommandResult(null, error);
    if (verbose) console.log(`[VERBOSE] isolation-runner: $ --resume-all failed${unsupported ? ' (verb not supported by this $ build)' : ''}: ${message}`);
    return { ...base, unsupported, output: stdout, error: message };
  }
}
