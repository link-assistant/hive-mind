/**
 * `/fix` progress markers shared by `fix.mjs` and the Telegram session monitor
 * (issue #3326).
 *
 * `/fix` creates its issue immediately, then waits for the default branch
 * CI/CD to finish before starting `/solve`. That wait can take many minutes,
 * during which the Telegram reply used to say only "⏳ Executing...". `fix.mjs`
 * now prints one `[HIVE-MIND FIX] {json}` line per phase change / poll, and the
 * monitor turns the latest one into a visible status.
 *
 * Kept free of GitHub/network imports so the Telegram bot can load it cheaply.
 */
import { readLogTailText } from './log-bounded-read.lib.mjs';
import { safeEditMessageText } from './telegram-safe-reply.lib.mjs';
import { formatExecutingWorkSessionMessage, insertInfoBlockUrlLine } from './work-session-formatting.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { t } from './i18n.lib.mjs';

function text(locale, key, fallback, params = {}) {
  if (locale) return t(key, params, { locale });
  return Object.entries(params).reduce((out, [name, value]) => out.split(`{{${name}}}`).join(String(value)), fallback);
}

export const FIX_PROGRESS_MARKER = '[HIVE-MIND FIX]';

/** Phases in the order `fix.mjs` goes through them. */
export const FIX_PROGRESS_PHASES = Object.freeze(['issue-created', 'waiting-for-ci', 'ci-finished', 'solving']);

/** Bytes of log tail inspected per monitor tick; markers are short and recent. */
export const FIX_PROGRESS_TAIL_BYTES = 32768;

export function fixProgressLogLine(event) {
  return `${FIX_PROGRESS_MARKER} ${JSON.stringify({ ...event, at: event.at || new Date().toISOString() })}`;
}

/** The latest valid `/fix` progress event in `logText`, or `null`. */
export function parseFixProgressEvent(logText) {
  const lines = String(logText || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^(?:\[[^\]]*\] )*\[HIVE-MIND FIX\] (\{.*\})\r?$/.exec(lines[i]);
    if (!match) continue;
    try {
      const event = JSON.parse(match[1]);
      if (event && FIX_PROGRESS_PHASES.includes(event.phase)) return event;
    } catch {
      // Tool output may quote or truncate markers.
    }
  }
  return null;
}

export function formatDurationShort(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function codeSpan(value) {
  return `\`${String(value ?? '').replace(/`/g, "'")}\``;
}

function describePending(pending = []) {
  const list = Array.isArray(pending) ? pending : [];
  const shown = list.slice(0, 5).map(item => `${codeSpan(item.name || 'workflow')} (${item.status || 'pending'})`);
  if (list.length > shown.length) shown.push(`+${list.length - shown.length} more`);
  return shown.join(', ');
}

/**
 * Status lines describing a `/fix` progress event, placed above the usual
 * session details of the Telegram reply.
 */
export function formatFixProgressStatus(event, { locale = null } = {}) {
  if (!event) return null;
  const branch = codeSpan(event.branch || 'default branch');
  const lines = [];
  if (event.phase === 'waiting-for-ci') {
    lines.push(text(locale, 'telegram.fix.waiting_for_ci', '⏳ Waiting for CI/CD on {{branch}} to finish before starting the task...', { branch }));
    const pending = describePending(event.pending);
    if (pending) lines.push(`🔄 ${text(locale, 'telegram.fix.ci_pending_label', 'Running')}: ${pending}`);
    if (Number.isFinite(event.waitedMs)) {
      const waited = formatDurationShort(event.waitedMs);
      lines.push(Number.isFinite(event.timeoutMs) ? text(locale, 'telegram.fix.ci_waited_of', '⏱ Waited {{waited}} of {{timeout}}', { waited, timeout: formatDurationShort(event.timeoutMs) }) : `⏱ ${waited}`);
    }
  } else if (event.phase === 'ci-finished') {
    lines.push(formatCiOutcomeLine(event, { locale, branch }));
  } else if (event.phase === 'issue-created') {
    lines.push(text(locale, 'telegram.fix.issue_created', '📝 Issue created, preparing to start the task...'));
  } else {
    lines.push(text(locale, 'telegram.work_session_executing', '⏳ Executing...'));
    if (event.ciOutcome) lines.push(formatCiOutcomeLine({ ...event, outcome: event.ciOutcome }, { locale, branch }));
  }
  if (event.issueUrl) lines.push(`📝 ${text(locale, 'telegram.fix.issue_label', 'Issue')}: ${event.issueUrl}`);
  return lines.join('\n');
}

function formatCiOutcomeLine(event, { locale, branch }) {
  const waited = Number.isFinite(event.waitedMs) && event.waitedMs > 0 ? ` (${formatDurationShort(event.waitedMs)})` : '';
  if (event.outcome === 'timeout') return text(locale, 'telegram.fix.ci_wait_timeout', '⚠️ CI/CD on {{branch}} was still running after {{timeout}}; starting the task anyway', { branch, timeout: formatDurationShort(event.timeoutMs) });
  if (event.outcome === 'unknown') return text(locale, 'telegram.fix.ci_wait_unknown', '⚠️ Could not check CI/CD on {{branch}}; starting the task anyway', { branch });
  if (event.outcome === 'skipped') return text(locale, 'telegram.fix.ci_wait_skipped', 'ℹ️ Not waiting for CI/CD on {{branch}} (--no-wait-for-ci)', { branch });
  if (event.outcome === 'idle') return text(locale, 'telegram.fix.ci_idle', '✅ No CI/CD running on {{branch}}', { branch });
  return `${text(locale, 'telegram.fix.ci_finished', '✅ CI/CD on {{branch}} finished', { branch })}${waited}`;
}

/** The full Telegram reply text for a running `/fix` session. */
export function formatFixProgressMessage({ event, sessionName, sessionInfo = {}, locale = null }) {
  const status = formatFixProgressStatus(event, { locale });
  if (!status) return null;
  return formatExecutingWorkSessionMessage({ sessionName, executionUuid: sessionInfo.executionUuid || null, isolationBackend: sessionInfo.isolationBackend || null, infoBlock: sessionInfo.infoBlock || '', locale, header: status });
}

/**
 * Mirror the latest `/fix` progress marker into the Telegram reply.
 *
 * Best effort: never throws and never changes the task. Stops reading the log
 * once the `solving` phase was shown (or the markers scrolled out of the tail),
 * so long `/solve` logs are not re-read on every monitor tick.
 */
export async function reportFixProgress({ bot, sessionName, sessionInfo, statusResult = null, verbose = false, readTail = readLogTailText, persist = () => {} } = {}) {
  try {
    if (!sessionInfo || sessionInfo.command !== 'fix') return null;
    const state = sessionInfo.fixProgress || {};
    if (state.done) return null;
    const logPath = statusResult?.logPath || sessionInfo.logPath || null;
    if (!logPath) return null;
    const event = parseFixProgressEvent(await readTail(logPath, { maxBytes: FIX_PROGRESS_TAIL_BYTES }));
    if (!event) {
      // Markers are printed before /solve starts; once its output pushed them
      // out of the tail there is nothing left to report.
      if (state.phase) {
        sessionInfo.fixProgress = { ...state, done: true };
        persist();
      }
      return null;
    }
    const key = JSON.stringify([event.phase, event.issueUrl || null, event.outcome || event.ciOutcome || null, (event.pending || []).map(item => `${item.name}:${item.status}`), event.phase === 'waiting-for-ci' ? Math.floor((event.waitedMs || 0) / 60000) : 0]);
    if (key === state.key) return null;
    const message = formatFixProgressMessage({ event, sessionName, sessionInfo, locale: sessionInfo.locale || null });
    if (!message || !bot?.telegram || !sessionInfo.messageId) return null;
    let delivered = false;
    try {
      await safeEditMessageText(bot.telegram, sessionInfo.chatId, sessionInfo.messageId, undefined, message, { locale: sessionInfo.locale, verbose });
      delivered = true;
    } catch (error) {
      if (/message is not modified/i.test(error?.message || '')) delivered = true;
      else console.warn(`[fix-progress] Telegram update failed for ${sessionName}: ${error?.message || error}`);
    }
    if (delivered) {
      // Keep the issue link in the completion message once live updates stop.
      // Issue #3469: placed after the `Repository:` line, not after the options.
      const infoBlock = String(sessionInfo.infoBlock || '');
      if (event.phase === 'solving' && event.issueUrl && !infoBlock.includes(event.issueUrl) && !infoBlock.includes(escapeMarkdown(event.issueUrl))) {
        sessionInfo.infoBlock = insertInfoBlockUrlLine(infoBlock, `${text(sessionInfo.locale || null, 'telegram.fix.issue_label', 'Issue')}: ${escapeMarkdown(event.issueUrl)}`, { locale: sessionInfo.locale || null });
      }
      // Issue #3469: the issue URL and last event let the monitor resolve the
      // session's PR and redraw this status when the PR link is added.
      sessionInfo.fixProgress = { phase: event.phase, key, issueUrl: event.issueUrl || null, event, done: event.phase === 'solving' };
      if (verbose) console.log(`[VERBOSE] [fix-progress] ${sessionName}: ${event.phase}${event.issueUrl ? ` ${event.issueUrl}` : ''}`);
      persist();
    }
    return delivered ? message : null;
  } catch (error) {
    console.warn(`[fix-progress] Progress reporting failed for ${sessionName}: ${error?.message || error}`);
    return null;
  }
}
