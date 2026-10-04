/**
 * How Hive Mind reacts when a detached work session is killed (issue #2134).
 *
 * The issue asks for one configurable behaviour that every surface honours
 * identically — the Telegram completion message and the pull-request notice must
 * never disagree about what happened:
 *
 *   - `report`: the kill is terminal. The Telegram message says the session was
 *     killed, with the diagnosed cause, and offers the resume command. The pull
 *     request gets the same notice.
 *   - `resume` (default since issue #2189): the kill is treated as recoverable.
 *     A new working session is started from the last tool session id, and BOTH
 *     surfaces say so ("recovered from out of memory" / "a new working session
 *     was started").
 *
 * Selected by `--on-session-kill=<policy>` or `HIVE_MIND_ON_SESSION_KILL`, with
 * the CLI flag winning over the environment. Nothing is removed by choosing one
 * over the other: `resume` still reports the kill and its cause, it just adds
 * the recovery, and log uploads stay gated on `--attach-logs` in both modes.
 *
 * Why `resume` is the default (issue #2189): under `report` the bot only ever
 * *offered* a resume command that a human had to notice and paste. In the
 * captured incident the offer reached the operator six hours after the crash,
 * and the work sat abandoned in between. "The bot should initiate the resume
 * itself with context preserved" — so it does, bounded by
 * `--session-kill-resume-attempts` (default 3, issue #2408) so a job that reliably
 * dies still cannot storm. `--on-session-kill=report` restores the announce-only
 * behaviour verbatim for anyone who wants it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2134
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

export const ON_SESSION_KILL_REPORT = 'report';
export const ON_SESSION_KILL_RESUME = 'resume';
export const ON_SESSION_KILL_POLICIES = [ON_SESSION_KILL_REPORT, ON_SESSION_KILL_RESUME];
export const DEFAULT_ON_SESSION_KILL_POLICY = ON_SESSION_KILL_RESUME;

export const ON_SESSION_KILL_ENV_VAR = 'HIVE_MIND_ON_SESSION_KILL';

/**
 * Hard cap on automatic resumes per session, so a reliably OOM-ing job cannot
 * storm. Issue #2408: a single attempt left a long session that met two
 * independent OOM events failed, with its first recovery spent long before the
 * second kill — three keeps the storm bounded while a second OOM is recovered.
 */
export const DEFAULT_SESSION_KILL_RESUME_ATTEMPTS = 3;
export const SESSION_KILL_RESUME_ATTEMPTS_ENV_VAR = 'HIVE_MIND_SESSION_KILL_RESUME_ATTEMPTS';

/**
 * Issue #2498: one OOM event can kill several work sessions (or several tool
 * processes) at once. Restarting all of them in the same second sends every
 * recovery at the same memory, the same CPUs and the same API at once — the
 * very rush that caused the event. Each recovery therefore waits a random
 * delay, in seconds, drawn uniformly from this range before it starts.
 */
export const DEFAULT_SESSION_KILL_RESUME_DELAY_RANGE = Object.freeze({ minSeconds: 30, maxSeconds: 90 });
export const SESSION_KILL_RESUME_DELAY_ENV_VAR = 'HIVE_MIND_SESSION_KILL_RESUME_DELAY';

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Resolve the configured on-kill policy.
 *
 * @param {Object} [options]
 * @param {Object} [options.argv] - yargs argv (`onSessionKill` / `on-session-kill`)
 * @param {Object} [options.env=process.env]
 * @param {Object} [options.sessionInfo] - Persisted session info (per-session override)
 * @param {boolean} [options.verbose]
 * @returns {string} One of ON_SESSION_KILL_POLICIES
 */
export function resolveOnSessionKillPolicy({ argv = null, env = process.env, sessionInfo = null, verbose = false } = {}) {
  const candidates = [
    { source: 'session', raw: sessionInfo?.onSessionKill },
    { source: '--on-session-kill', raw: argv?.onSessionKill ?? argv?.['on-session-kill'] },
    { source: ON_SESSION_KILL_ENV_VAR, raw: env?.[ON_SESSION_KILL_ENV_VAR] },
  ];
  for (const { source, raw } of candidates) {
    const normalized = normalize(raw);
    if (!normalized) continue;
    if (ON_SESSION_KILL_POLICIES.includes(normalized)) return normalized;
    if (verbose) {
      console.log(`[VERBOSE] Invalid ${source}='${raw}', using '${DEFAULT_ON_SESSION_KILL_POLICY}' (valid: ${ON_SESSION_KILL_POLICIES.join(', ')})`);
    }
  }
  return DEFAULT_ON_SESSION_KILL_POLICY;
}

/**
 * Maximum number of automatic resumes for one killed session.
 *
 * @param {Object} [options]
 * @param {Object} [options.argv]
 * @param {Object} [options.env=process.env]
 * @returns {number} A non-negative integer
 */
export function resolveSessionKillResumeAttempts({ argv = null, env = process.env } = {}) {
  const raw = argv?.sessionKillResumeAttempts ?? argv?.['session-kill-resume-attempts'] ?? env?.[SESSION_KILL_RESUME_ATTEMPTS_ENV_VAR];
  const text = String(raw ?? '').trim();
  // An unset flag/variable is an empty string, and `Number('')` is 0 — which
  // would silently disable resuming instead of using the default.
  if (text === '') return DEFAULT_SESSION_KILL_RESUME_ATTEMPTS;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SESSION_KILL_RESUME_ATTEMPTS;
  return Math.floor(parsed);
}

/**
 * Random delay range before an automatic recovery starts (issue #2498).
 *
 * Accepts `"<min>-<max>"` or a single `"<seconds>"` (a fixed delay); `0`
 * disables the wait. Anything unparsable falls back to the default range.
 *
 * @param {Object} [options]
 * @param {Object} [options.argv] - yargs argv (`sessionKillResumeDelay` / `session-kill-resume-delay`)
 * @param {Object} [options.env=process.env]
 * @returns {{minSeconds: number, maxSeconds: number}}
 */
export function resolveSessionKillResumeDelayRange({ argv = null, env = process.env } = {}) {
  const raw = argv?.sessionKillResumeDelay ?? argv?.['session-kill-resume-delay'] ?? env?.[SESSION_KILL_RESUME_DELAY_ENV_VAR];
  const match = String(raw ?? '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?$/);
  if (!match) return { ...DEFAULT_SESSION_KILL_RESUME_DELAY_RANGE };
  const first = Number(match[1]);
  const second = match[2] === undefined ? first : Number(match[2]);
  return { minSeconds: Math.min(first, second), maxSeconds: Math.max(first, second) };
}

/**
 * Pick the delay, in milliseconds, before one automatic recovery starts.
 *
 * @param {Object} [options] - See resolveSessionKillResumeDelayRange(); plus `random`
 * @param {Function} [options.random=Math.random] - Test seam
 * @returns {number}
 */
export function pickSessionKillResumeDelayMs({ argv = null, env = process.env, random = Math.random } = {}) {
  const { minSeconds, maxSeconds } = resolveSessionKillResumeDelayRange({ argv, env });
  return Math.round((minSeconds + (maxSeconds - minSeconds) * random()) * 1000);
}

/**
 * Whether a killed session should be auto-resumed under the resolved policy.
 *
 * @param {Object} [options]
 * @param {string} [options.policy]
 * @param {boolean} [options.killed] - The completion outcome is a kill
 * @returns {boolean}
 */
export function shouldResumeKilledSession({ policy = DEFAULT_ON_SESSION_KILL_POLICY, killed = false } = {}) {
  return killed === true && policy === ON_SESSION_KILL_RESUME;
}
