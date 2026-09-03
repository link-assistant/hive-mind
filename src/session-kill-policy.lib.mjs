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
 * `--session-kill-resume-attempts` (default 1) so a job that reliably dies still
 * cannot storm. `--on-session-kill=report` restores the announce-only
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

/** Hard cap on automatic resumes per session, so a reliably OOM-ing job cannot storm. */
export const DEFAULT_SESSION_KILL_RESUME_ATTEMPTS = 1;
export const SESSION_KILL_RESUME_ATTEMPTS_ENV_VAR = 'HIVE_MIND_SESSION_KILL_RESUME_ATTEMPTS';

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
