/**
 * `/fix` progress markers shared by `fix.mjs` and the Telegram session monitor
 * (issue #3326).
 *
 * `/fix` creates its issue immediately, then waits for the default branch
 * CI/CD to finish before starting `/solve`. That wait can take many minutes,
 * during which the Telegram reply used to say only "⏳ Executing...". `fix.mjs`
 * now prints one `[HIVE-MIND FIX] {json}` line per phase change / poll, and the
 * monitor turns the latest one into a visible status: `🔄 Starting...` →
 * `⏳ Waiting for CI/CD on ... branch to finish...` → `⏳ Executing...`
 * (issue #3505).
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

/**
 * The one-line status a `/fix` progress event shows above the session details.
 *
 * Issue #3505: the reply goes `🔄 Starting...` → `⏳ Waiting for CI/CD...` →
 * `⏳ Executing...`, one simple line per phase. The CI wait used to list every
 * pending workflow and a "waited X of Y" timer, and its outcome stayed in the
 * reply for the whole task; none of that is worth a permanent line (the CI/CD
 * results are commented on the issue instead). The issue link is not part of
 * the status either: it lives in the info block, under the repository line.
 */
export function formatFixProgressStatus(event, { locale = null } = {}) {
  if (!event) return null;
  if (event.phase === 'waiting-for-ci') {
    if (!event.branch) return text(locale, 'telegram.fix.waiting_for_ci_default_branch', '⏳ Waiting for CI/CD on the default branch to finish...');
    return text(locale, 'telegram.fix.waiting_for_ci', '⏳ Waiting for CI/CD on {{branch}} branch to finish...', { branch: codeSpan(event.branch) });
  }
  if (event.phase === 'solving') return text(locale, 'telegram.work_session_executing', '⏳ Executing...');
  // `issue-created` and `ci-finished`: the task itself has not started yet.
  return text(locale, 'telegram.work_session_starting', '🔄 Starting...');
}

/** `infoBlock` with the `/fix` issue line placed right under the repository line. */
export function addFixIssueToInfoBlock(infoBlock, issueUrl, { locale = null } = {}) {
  const block = String(infoBlock || '');
  if (!issueUrl || block.includes(issueUrl) || block.includes(escapeMarkdown(issueUrl))) return block;
  return insertInfoBlockUrlLine(block, `${text(locale, 'telegram.fix.issue_label', 'Issue')}: ${escapeMarkdown(issueUrl)}`, { locale });
}

/** The full Telegram reply text for a running `/fix` session. */
export function formatFixProgressMessage({ event, sessionName, sessionInfo = {}, locale = null }) {
  const status = formatFixProgressStatus(event, { locale });
  if (!status) return null;
  return formatExecutingWorkSessionMessage({ sessionName, executionUuid: sessionInfo.executionUuid || null, isolationBackend: sessionInfo.isolationBackend || null, infoBlock: sessionInfo.infoBlock || '', locale, header: status });
}

/**
 * The running reply of a launched `/fix` session: its latest progress status,
 * or `🔄 Starting...` until the first marker. `/fix` creates an issue and waits
 * for CI/CD before the task runs, so "⏳ Executing..." appears only once the
 * `solving` marker was seen (issue #3505).
 */
export function formatLaunchedFixMessage({ sessionName, sessionInfo = {}, locale = null }) {
  return formatFixProgressMessage({ event: sessionInfo.fixProgress?.event || { phase: 'issue-created' }, sessionName, sessionInfo, locale });
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
    let event = parseFixProgressEvent(await readTail(logPath, { maxBytes: FIX_PROGRESS_TAIL_BYTES }));
    if (!event) {
      if (!state.phase) return null;
      // Markers are printed before /solve starts; once its output pushed them
      // out of the tail, /solve is running. Issue #3505: a `solving` marker that
      // scrolled out between two ticks must not leave the reply on "Waiting for
      // CI/CD" for the whole task, so show "Executing" once before stopping.
      if (state.phase === 'solving') {
        sessionInfo.fixProgress = { ...state, done: true };
        persist();
        return null;
      }
      if (verbose) console.log(`[VERBOSE] [fix-progress] ${sessionName}: markers left the log tail after '${state.phase}'; /solve is running`);
      event = { ...(state.event || {}), phase: 'solving', issueUrl: state.issueUrl || state.event?.issueUrl || null };
    }
    // Issue #3505: each status is one line, so only a new phase is worth an
    // edit; repeated CI polls of the same phase change nothing on screen.
    const key = JSON.stringify([event.phase, event.issueUrl || null]);
    if (key === state.key) return null;
    const locale = sessionInfo.locale || null;
    // Issue #3505: the issue link goes into the info block with the first
    // marker that names it, under `Repository:`, and stays there unchanged
    // through every later status and the completion message.
    const infoBlock = addFixIssueToInfoBlock(sessionInfo.infoBlock, event.issueUrl, { locale });
    const message = formatFixProgressMessage({ event, sessionName, sessionInfo: { ...sessionInfo, infoBlock }, locale });
    if (!message || !bot?.telegram || !sessionInfo.messageId) return null;
    let delivered = false;
    try {
      await safeEditMessageText(bot.telegram, sessionInfo.chatId, sessionInfo.messageId, undefined, message, { locale, verbose });
      delivered = true;
    } catch (error) {
      if (/message is not modified/i.test(error?.message || '')) delivered = true;
      else console.warn(`[fix-progress] Telegram update failed for ${sessionName}: ${error?.message || error}`);
    }
    if (delivered) {
      // Kept for the completion message once live updates stop (issue #3469).
      sessionInfo.infoBlock = infoBlock;
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
