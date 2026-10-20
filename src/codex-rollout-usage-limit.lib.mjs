/**
 * Issue #3570: on a failed Codex exit, cross-check the thread's rollout before
 * the run is reported as a bare "Codex command failed with exit code N".
 *
 * The Claude side of issue #3570 showed that a usage limit can reach only the
 * tool's own session file, never stdout. Codex has the same gap: `codex exec
 * --json` reports `thread/turn/item` events only, so when the process exits
 * non-zero without a stream `error` event, `stderr`/`lastMessage` are the only
 * sources solve read. The rollout `$CODEX_HOME/sessions/YYYY/MM/DD/
 * rollout-<ts>-<thread id>.jsonl` keeps two more:
 *
 *   1. `event_msg` `token_count` with `rate_limits.{primary,secondary}`
 *      (`used_percent`, `window_minutes`, `resets_at` epoch seconds) and
 *      `rate_limit_reached_type`. Persisted by every Codex version
 *      (codex-rs/rollout/src/policy.rs: `EventMsg::TokenCount(_)`).
 *   2. `event_msg` `error` with `message` and `codex_error_info`
 *      (`usage_limit_exceeded`). Current Codex treats `Error` as transient and
 *      does not persist it, so it is read only when an older rollout has it.
 *
 * Only the last turn is read (back to its `task_started`/`turn_started`), so a
 * limit that an earlier turn hit and waited out is not reported again.
 */

import os from 'os';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { detectUsageLimit, formatUsageLimitMessage } from './usage-limit.lib.mjs';
import { CODEX_SESSIONS_DIRNAME, findCodexRolloutFile } from './codex-sessions.lib.mjs';
import { readLogTailText } from './log-bounded-read.lib.mjs';
import { combineClaudeUsageLimitVerdicts, formatEpochResetTimeUtc, usageLimitTextVerdict } from './claude.usage-limit-sources.lib.mjs';

const ROLLOUT_TAIL_BYTES = 1024 * 1024;
const TURN_START_TYPES = new Set(['task_started', 'turn_started']);
const WINDOW_LABELS = { 300: '5-hour', 10080: 'weekly' };

const describeCodexWindow = minutes => WINDOW_LABELS[minutes] || (Number.isFinite(minutes) && minutes > 0 ? `${minutes}-minute` : 'usage');

/**
 * Classify a rollout `token_count.rate_limits` snapshot. A window counts as
 * reached at `used_percent >= 100` with a `resets_at`; `rate_limit_reached_type`
 * alone (no reset) stays unclassified, like the Claude throttle of issue #1924.
 */
export const classifyCodexRateLimitSnapshot = snapshot => {
  if (!snapshot || typeof snapshot !== 'object') return { isUsageLimit: false, reason: 'no rate_limits snapshot' };
  const windows = ['primary', 'secondary'].map(name => ({ name, ...snapshot[name] })).filter(w => Number.isFinite(Number(w.used_percent)));
  const reached = windows.filter(w => Number(w.used_percent) >= 100 && Number(w.resets_at) > 0).sort((a, b) => Number(b.resets_at) - Number(a.resets_at));
  const reachedType = snapshot.rate_limit_reached_type || null;
  if (reached.length === 0) {
    const peak = windows.length ? `peak used_percent ${Math.max(...windows.map(w => Number(w.used_percent)))}` : 'no windows';
    return { isUsageLimit: false, reason: `no window at 100% with resets_at (${peak}${reachedType ? `, rate_limit_reached_type ${reachedType}` : ''})` };
  }
  // The latest reset is when every exhausted window is usable again.
  const window = reached[0];
  const windowLabel = describeCodexWindow(Number(window.window_minutes));
  return { isUsageLimit: true, reason: `${window.name} ${windowLabel} window at ${window.used_percent}%${reachedType ? ` (${reachedType})` : ''}`, resetTime: formatEpochResetTimeUtc(window.resets_at), timezone: 'UTC', resetsAt: Number(window.resets_at), windowLabel };
};

const isUsageLimitErrorInfo = info => Boolean(info) && /usage_limit_exceeded/i.test(typeof info === 'string' ? info : JSON.stringify(info));

/**
 * Read the last turn of a Codex rollout and return its newest `rate_limits`
 * snapshot and usage-limit `error`, if any.
 *
 * @returns {Promise<{found: boolean, rolloutPath?: string, reason?: string, rateLimits?: object|null, errorText?: string|null, errorInfo?: any}>}
 */
export const readCodexRolloutLimitFacts = async ({ threadId, codexHome, homeDir = os.homedir(), fsImpl = fsPromises, maxBytes = ROLLOUT_TAIL_BYTES } = {}) => {
  if (!threadId) return { found: false, reason: 'no thread id' };
  const sessionsDir = path.join(codexHome || path.join(homeDir, '.codex'), CODEX_SESSIONS_DIRNAME);
  const rolloutPath = await findCodexRolloutFile({ sessionsDir, threadId, fsImpl });
  if (!rolloutPath) return { found: false, reason: `no rollout under ${sessionsDir}` };
  const lines = (await readLogTailText(rolloutPath, { fsImpl, maxBytes })).split('\n');
  const facts = { found: true, rolloutPath, rateLimits: null, errorText: null, errorInfo: null };
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry?.type !== 'event_msg') continue;
    const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : entry;
    if (TURN_START_TYPES.has(payload.type)) break;
    if (payload.type === 'token_count' && payload.rate_limits && !facts.rateLimits) facts.rateLimits = payload.rate_limits;
    if (payload.type === 'error' && !facts.errorText && (isUsageLimitErrorInfo(payload.codex_error_info) || detectUsageLimit(String(payload.message || '')).isUsageLimit)) {
      facts.errorText = String(payload.message || 'usage_limit_exceeded');
      facts.errorInfo = payload.codex_error_info ?? null;
    }
  }
  return facts;
};

/**
 * Failure-path entry point for a non-zero Codex exit: cross-check stderr /
 * last message with the rollout, log each verdict in verbose mode, and log the
 * user-facing usage-limit message when any source finds the limit.
 *
 * @returns {Promise<{isUsageLimit: boolean, resetTime: string|null, timezone: string|null, message: string|null, sources: string[]}>}
 */
export const resolveCodexExitUsageLimit = async ({ failureSource, signal, exitCode, threadId, codexHome, homeDir, fsImpl, buildResumeCommand = () => null, log = async () => {} } = {}) => {
  // A killed process cannot report a provider limit; its last stdout may
  // contain a build log replaying an earlier network/usage error.
  if (signal) return { isUsageLimit: false, resetTime: null, timezone: null, message: null, sources: [] };
  const rollout = await readCodexRolloutLimitFacts({ threadId, codexHome, homeDir, fsImpl }).catch(error => ({ found: false, reason: error.message }));
  const missing = { isUsageLimit: false, reason: rollout.reason };
  const verdicts = [usageLimitTextVerdict('stderr / last message', failureSource), rollout.found ? usageLimitTextVerdict('rollout error event', rollout.errorText) : { source: 'rollout error event', ...missing }, { source: 'rollout rate_limits', ...(rollout.found ? classifyCodexRateLimitSnapshot(rollout.rateLimits) : missing) }];
  if (rollout.found && rollout.errorText && !verdicts[1].isUsageLimit) Object.assign(verdicts[1], { isUsageLimit: true, reason: `codex_error_info ${JSON.stringify(rollout.errorInfo)}` });
  const limitInfo = combineClaudeUsageLimitVerdicts(verdicts, 'Codex');
  await log('🔍 Usage-limit cross-check (issue #3570):', { verbose: true });
  for (const v of verdicts) await log(`   ${v.isUsageLimit ? '✔' : '·'} ${v.source}: ${v.reason}${v.resetTime ? `, reset ${v.resetTime}${v.timezone ? ` (${v.timezone})` : ''}` : ''}`, { verbose: true });
  if (rollout.rolloutPath) await log(`   rollout: ${rollout.rolloutPath}`, { verbose: true });
  if (!limitInfo.isUsageLimit) return limitInfo;
  if (!verdicts[0].isUsageLimit) await log(`⚠️ Usage limit found only in: ${limitInfo.sources.join(', ')} — Codex did not report it on stderr/stdout (issue #3570)`, { level: 'warning' });
  // Issue #1869: Trace raw limit text + parsed reset for diagnosability.
  await log(`🔍 Codex usage limit detected (exit ${exitCode}). Raw message: ${JSON.stringify(limitInfo.message)}`, { verbose: true });
  await log(`🔍 Parsed reset time: ${JSON.stringify(limitInfo.resetTime)}, timezone: ${JSON.stringify(limitInfo.timezone)}`, { verbose: true });
  // Issue #942: build proper solve resume command (preserves tool/model/dir).
  for (const line of formatUsageLimitMessage({ tool: 'OpenAI Codex', resetTime: limitInfo.resetTime, sessionId: threadId, solveResumeCommand: buildResumeCommand() })) await log(line, { level: 'warning' });
  return limitInfo;
};

export default { classifyCodexRateLimitSnapshot, readCodexRolloutLimitFacts, resolveCodexExitUsageLimit };
