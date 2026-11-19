/**
 * `/solve` phase markers shared by `solve` and the Telegram session monitor
 * (issue #4091), modelled on the `/fix` markers (issue #3326).
 *
 * After its AI session, `solve` uploads the log and then monitors the pull
 * request (`--auto-restart-until-mergeable`, on by default). That phase can
 * take hours; the Telegram reply used to say `⏳ Executing...` the whole time.
 * `solve` now prints one `[HIVE-MIND SOLVE] {json}` line per phase change and
 * per watch-loop check:
 *
 *   {"phase":"watch","blocker":"ci_pending","detail":"W pending, concurrency queue, 0 jobs, for 3h 12m",
 *    "check":87,"since":"…","deadline":"…","at":"…"}
 *
 * and the monitor turns the latest one into the reply header. The header is
 * redrawn at least every SOLVE_PROGRESS_REFRESH_MS even when nothing changes,
 * and it shows when `solve` printed the marker, so a frozen status means a
 * frozen process.
 *
 * The kill diagnostics read the same marker to say what the session was doing
 * when it was stopped.
 *
 * Kept free of GitHub/network imports so the Telegram bot can load it cheaply.
 */
import { readLogTailText } from './log-bounded-read.lib.mjs';
import { safeEditMessageText } from './telegram-safe-reply.lib.mjs';
import { formatExecutingWorkSessionMessage } from './work-session-formatting.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { formatDurationShort } from './fix-progress.lib.mjs';
import { t } from './i18n.lib.mjs';

function text(locale, key, fallback, params = {}) {
  if (locale) return t(key, params, { locale });
  return Object.entries(params).reduce((out, [name, value]) => out.split(`{{${name}}}`).join(String(value)), fallback);
}

export const SOLVE_PROGRESS_MARKER = '[HIVE-MIND SOLVE]';

/**
 * Phases of a `/solve` session after it started:
 *  - `executing`: the AI tool runs (the only phase shown as `⏳ Executing...`);
 *  - `uploading-log`: a session log is sanitized and uploaded;
 *  - `watch`: the AI finished; the pull request is monitored until mergeable;
 *  - `finished`: monitoring ended with a decision (`decision`, `reason`).
 */
export const SOLVE_PROGRESS_PHASES = Object.freeze(['executing', 'uploading-log', 'watch', 'finished']);

/** Bytes of log tail inspected per monitor tick. A watch check prints a few KB. */
export const SOLVE_PROGRESS_TAIL_BYTES = 65536;

/** The reply is redrawn at least this often while a phase lasts (the monitor ticks every 30 s). */
export const SOLVE_PROGRESS_REFRESH_MS = 5 * 60 * 1000;

export function solveProgressLogLine(event) {
  return `${SOLVE_PROGRESS_MARKER} ${JSON.stringify({ ...event, at: event.at || new Date().toISOString() })}`;
}

let lastEmittedEvent = null;

/**
 * Print a `/solve` progress marker on stdout (the session log the Telegram
 * monitor tails) and remember it, so the interrupt handler can name the phase
 * it interrupted.
 */
export function emitSolveProgress(event, { write = line => console.log(line) } = {}) {
  const stamped = { ...event, at: event.at || new Date().toISOString() };
  lastEmittedEvent = stamped;
  try {
    write(solveProgressLogLine(stamped));
  } catch {
    // Progress reporting never breaks the session.
  }
  return stamped;
}

/** The last marker this process printed, or null. */
export const getLastSolveProgress = () => lastEmittedEvent;

/** Tests only. */
export const resetSolveProgressForTests = () => {
  lastEmittedEvent = null;
};

/** The latest valid `/solve` progress event in `logText`, or `null`. */
export function parseSolveProgressEvent(logText) {
  const lines = String(logText || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^(?:\[[^\]]*\] )*\[HIVE-MIND SOLVE\] (\{.*\})\r?$/.exec(lines[i]);
    if (!match) continue;
    try {
      const event = JSON.parse(match[1]);
      if (event && SOLVE_PROGRESS_PHASES.includes(event.phase)) return event;
    } catch {
      // Tool output may quote or truncate markers.
    }
  }
  return null;
}

/** "2026-11-19 03:10 UTC", or '' for an invalid time. */
export function formatUtcMinute(value) {
  const time = new Date(value ?? NaN);
  if (!Number.isFinite(time.getTime())) return '';
  return `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The reply header for a `/solve` progress event: phase, blocker, time since
 * the phase started, deadline and the time the marker was printed.
 * @telegram-markdown
 */
export function formatSolveProgressStatus(event, { locale = null, now = Date.now() } = {}) {
  if (!event) return null;
  if (event.phase === 'uploading-log') return text(locale, 'telegram.solve_progress.uploading_log', '📎 Uploading the session log...');
  if (event.phase !== 'watch') return text(locale, 'telegram.work_session_executing', '⏳ Executing...');
  const lines = [text(locale, 'telegram.solve_progress.watching', '⏳ Monitoring the pull request until it is mergeable')];
  const blocker = [event.blockerLabel || event.blocker, event.detail].filter(Boolean).join(': ');
  if (blocker) lines.push(text(locale, 'telegram.solve_progress.blocker', 'Waiting for: {{blocker}}', { blocker: escapeMarkdown(blocker) }));
  const since = new Date(event.since ?? NaN).getTime();
  const elapsed = Number.isFinite(since) ? formatDurationShort(Math.max(0, now - since)) : '?';
  const deadline = formatUtcMinute(event.deadline) || '—';
  lines.push(text(locale, 'telegram.solve_progress.timing', 'Check #{{check}} · monitoring for {{elapsed}} · gives up at {{deadline}}', { check: escapeMarkdown(String(event.check ?? '?')), elapsed, deadline }));
  const at = formatUtcMinute(event.at);
  if (at) lines.push(text(locale, 'telegram.solve_progress.updated', 'Status updated {{time}}', { time: at }));
  return lines.join('\n');
}

/** The full Telegram reply text for a running `/solve` session. @telegram-markdown */
export function formatSolveProgressMessage({ event, sessionName, sessionInfo = {}, locale = null, now = Date.now() }) {
  const status = formatSolveProgressStatus(event, { locale, now });
  if (!status) return null;
  return formatExecutingWorkSessionMessage({ sessionName, executionUuid: sessionInfo.executionUuid || null, isolationBackend: sessionInfo.isolationBackend || null, infoBlock: sessionInfo.infoBlock || '', locale, header: status });
}

/** Identity of what the reply shows, without the ticking clocks; plus a refresh bucket. */
const progressKey = (event, now) => JSON.stringify([event.phase, event.blocker || null, event.detail || null, event.deadline || null, Math.floor(now / SOLVE_PROGRESS_REFRESH_MS)]);

/**
 * Mirror the latest `/solve` progress marker into the Telegram reply.
 *
 * Best effort: never throws and never changes the task. Before the first
 * marker the reply is left alone (`⏳ Executing...`). When the markers left the
 * log tail (the AI is printing again after a restart), the reply goes back to
 * `⏳ Executing...` once.
 */
export async function reportSolveProgress({ bot, sessionName, sessionInfo, statusResult = null, verbose = false, readTail = readLogTailText, persist = () => {}, now = Date.now(), editMessage = safeEditMessageText } = {}) {
  try {
    if (!sessionInfo || sessionInfo.command !== 'solve' || sessionInfo.recoveryLifecycle) return null;
    const state = sessionInfo.solveProgress || {};
    const logPath = statusResult?.logPath || sessionInfo.logPath || null;
    if (!logPath) return null;
    let event = parseSolveProgressEvent(await readTail(logPath, { maxBytes: SOLVE_PROGRESS_TAIL_BYTES }));
    if (!event) {
      if (!state.phase || state.phase === 'executing') return null;
      event = { phase: 'executing' };
    }
    if (event.phase === 'finished') return null; // the completion message follows
    const key = progressKey(event, now);
    if (key === state.key) return null;
    const locale = sessionInfo.locale || null;
    const message = formatSolveProgressMessage({ event, sessionName, sessionInfo, locale, now });
    if (!message || !bot?.telegram || !sessionInfo.messageId) return null;
    let delivered = false;
    try {
      await editMessage(bot.telegram, sessionInfo.chatId, sessionInfo.messageId, undefined, message, { locale, verbose });
      delivered = true;
    } catch (error) {
      if (/message is not modified/i.test(error?.message || '')) delivered = true;
      else console.warn(`[solve-progress] Telegram update failed for ${sessionName}: ${error?.message || error}`);
    }
    if (delivered) {
      // The live PR link redraws the reply with this header (session-live-pr-link).
      sessionInfo.solveProgress = { phase: event.phase, key, event, header: formatSolveProgressStatus(event, { locale, now }) };
      if (verbose) console.log(`[VERBOSE] [solve-progress] ${sessionName}: ${event.phase}${event.blocker ? ` (${event.blocker})` : ''}`);
      persist();
    }
    return delivered ? message : null;
  } catch (error) {
    console.warn(`[solve-progress] Progress reporting failed for ${sessionName}: ${error?.message || error}`);
    return null;
  }
}

/**
 * One line for kill diagnostics / stop notices, from the last marker:
 * "phase watch, check #135, waiting for ci_pending: W pending …, since …, deadline …, last marker …".
 */
export function describeSolveProgressForDiagnostics(event) {
  if (!event) return null;
  const parts = [`phase \`${event.phase === 'watch' ? 'watch_until_mergeable' : event.phase}\``];
  if (event.check != null) parts.push(`check #${event.check}`);
  const blocker = [event.blocker, event.detail].filter(Boolean).join(': ');
  if (blocker) parts.push(`waiting for ${blocker}`);
  if (event.since) parts.push(`since ${event.since}`);
  if (event.deadline) parts.push(`deadline ${event.deadline}`);
  if (event.at) parts.push(`last heartbeat ${event.at}`);
  return parts.join(', ');
}
