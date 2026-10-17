/**
 * Show a work session's pull request link in its Telegram status message as
 * soon as the PR exists (issue #3469).
 *
 * The link used to appear only in the completion message, and only for sessions
 * started on an issue URL: `/fix` starts on a repository URL and creates its
 * issue itself, so its "✅ Work session finished" reply named the issue and
 * never the pull request. While any session was running the reply said only
 * "⏳ Executing..." for the whole run, often more than an hour.
 *
 * The monitor now reads the growing session log incrementally (a bounded byte
 * range per tick, never the whole transcript) for the `PR URL:` line that solve
 * prints when it creates or reuses its PR, and edits the running reply once.
 * Only that labelled line is trusted while the session runs: a PR the agent
 * merely mentions is not the session's own (#2891).
 */
import fsPromises from 'fs/promises';
import { findLabeledSessionPullRequestUrl } from './session-own-pr.lib.mjs';
import { safeEditMessageText } from './telegram-safe-reply.lib.mjs';
import { appendPullRequestLine, formatExecutingWorkSessionMessage } from './work-session-formatting.lib.mjs';
import { formatFixProgressMessage } from './fix-progress.lib.mjs';

/** Bytes of new log text inspected per monitor tick. */
export const LIVE_PR_SCAN_CHUNK_BYTES = 4 * 1024 * 1024;
/** Bytes re-read before the saved offset so a line split across ticks is still found. */
export const LIVE_PR_SCAN_OVERLAP_BYTES = 1024;

const ISSUE_URL_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([0-9]+)/;

/** `{owner, repo, number, type: 'issue', normalized}` for a GitHub issue URL, or null. */
export function parseIssueUrlContext(url) {
  const match = ISSUE_URL_RE.exec(String(url || ''));
  if (!match) return null;
  const [, owner, repo, number] = match;
  return { owner, repo, number: Number(number), type: 'issue', normalized: `https://github.com/${owner}/${repo}/issues/${number}` };
}

/**
 * The issue a session works on: its start URL for `/solve` and `/task`, or the
 * issue `/fix` created (from its progress markers, else from the info block line
 * the progress reporter added). Null for sessions with no single issue (`/hive`).
 */
export function getSessionIssueContext(sessionInfo) {
  const ctx = sessionInfo?.urlContext;
  if (ctx?.type === 'issue' && ctx.owner && ctx.repo && ctx.number) return ctx;
  if (sessionInfo?.command !== 'fix') return null;
  const fromProgress = parseIssueUrlContext(sessionInfo.fixProgress?.issueUrl);
  if (fromProgress) return fromProgress;
  // The info block is Markdown-escaped (`\_`), so unescape before matching.
  return parseIssueUrlContext(String(sessionInfo.infoBlock || '').replace(/\\([_*[\]`])/g, '$1'));
}

/**
 * Scan the log bytes appended since `offset` for solve's `PR URL:` line.
 *
 * @returns {Promise<{url: string|null, offset: number}>} The PR URL (if found)
 *   and the byte offset the next scan starts from.
 */
export async function scanLogForLivePullRequestUrl(logPath, ctx, { fsImpl = fsPromises, offset = 0, chunkBytes = LIVE_PR_SCAN_CHUNK_BYTES, overlapBytes = LIVE_PR_SCAN_OVERLAP_BYTES } = {}) {
  const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  if (!logPath) return { url: null, offset: safeOffset };
  const { size } = await fsImpl.stat(logPath);
  // A truncated or replaced log restarts from the beginning.
  const from = size < safeOffset ? 0 : Math.max(0, safeOffset - overlapBytes);
  const to = Math.min(size, from + chunkBytes);
  if (to <= from) return { url: null, offset: size < safeOffset ? 0 : safeOffset };
  const handle = await fsImpl.open(logPath, 'r');
  try {
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buffer, 0, to - from, from);
    return { url: findLabeledSessionPullRequestUrl(buffer.subarray(0, bytesRead).toString('utf8'), ctx), offset: to };
  } finally {
    await handle.close();
  }
}

/** The running reply with the PR line added to its info block. */
export function formatLivePullRequestMessage({ sessionName, sessionInfo }) {
  const locale = sessionInfo.locale || null;
  const fixEvent = sessionInfo.command === 'fix' ? sessionInfo.fixProgress?.event : null;
  if (fixEvent) {
    // The info block already carries the issue line once /fix reached `solving`.
    const event = fixEvent.issueUrl && String(sessionInfo.infoBlock || '').includes(fixEvent.issueUrl) ? { ...fixEvent, issueUrl: null } : fixEvent;
    const message = formatFixProgressMessage({ event, sessionName, sessionInfo, locale });
    if (message) return message;
  }
  return formatExecutingWorkSessionMessage({ sessionName, executionUuid: sessionInfo.executionUuid || null, isolationBackend: sessionInfo.isolationBackend || null, infoBlock: sessionInfo.infoBlock || '', locale });
}

/**
 * Add the session's PR link to its running Telegram reply once solve printed it.
 *
 * Best effort: never throws. Skipped for sessions started on a pull request
 * (their reply already links it), for sessions with no issue, once the link was
 * shown, and while a kill recovery owns the reply. The URL is also remembered as
 * `resolvedPullRequestUrl`, so the completion message reuses it without another
 * GitHub lookup.
 *
 * @returns {Promise<string|null>} The PR URL when the reply was updated.
 */
export async function reportLivePullRequestLink({ bot, sessionName, sessionInfo, statusResult = null, verbose = false, persist = () => {}, fsImpl = fsPromises, editMessage = safeEditMessageText } = {}) {
  try {
    if (!sessionInfo || sessionInfo.urlContext?.type === 'pull' || sessionInfo.recoveryLifecycle) return null;
    const state = sessionInfo.livePullRequest || {};
    if (state.shownUrl) return null;
    const ctx = getSessionIssueContext(sessionInfo);
    const logPath = statusResult?.logPath || sessionInfo.logPath || null;
    if (!ctx || !logPath) return null;
    const scan = await scanLogForLivePullRequestUrl(logPath, ctx, { fsImpl, offset: state.offset || 0 });
    if (!scan.url) {
      // Kept in memory only: after a restart the scan starts over, one bounded
      // chunk per tick, instead of rewriting the session store every tick.
      sessionInfo.livePullRequest = { ...state, offset: scan.offset };
      return null;
    }
    const locale = sessionInfo.locale || null;
    sessionInfo.resolvedPullRequestUrl = scan.url;
    sessionInfo.infoBlock = appendPullRequestLine(sessionInfo.infoBlock || '', scan.url, { locale });
    sessionInfo.livePullRequest = { offset: scan.offset, shownUrl: scan.url };
    persist();
    if (verbose) console.log(`[VERBOSE] [live-pr-link] ${sessionName}: found ${scan.url} in ${logPath}; adding it to the running status message`);
    if (!bot?.telegram || !sessionInfo.messageId) return scan.url;
    try {
      await editMessage(bot.telegram, sessionInfo.chatId, sessionInfo.messageId, undefined, formatLivePullRequestMessage({ sessionName, sessionInfo }), { locale, verbose });
    } catch (error) {
      if (!/message is not modified/i.test(error?.message || '')) console.warn(`[live-pr-link] Telegram update failed for ${sessionName}: ${error?.message || error}`);
    }
    return scan.url;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] [live-pr-link] ${sessionName}: could not check the session log for its pull request: ${error?.message || error}`);
    return null;
  }
}
