/**
 * Issue #2293: detect *real* edits of a pull request / issue title and
 * description, with evidence.
 *
 * solve.feedback.lib.mjs used to treat `updated_at > last commit` as "the
 * description was edited". GitHub bumps `updated_at` for comments, labels,
 * cross-references and pull request creation, and real edits after the last
 * commit were usually made by the previous solver session, which shares the
 * human's GitHub login. Both were reported as human feedback and restarted the
 * AI on an edit that never happened.
 *
 * This module reads GitHub's edit history instead:
 *   - description edits come from `userContentEdits` (one node per saved body,
 *     `diff` holds the body as saved by that edit);
 *   - title edits come from `RenamedTitleEvent` timeline items;
 *   - an edit by the solver's account inside a solver session window (from a
 *     session start marker comment, or the pull request creation, to the last
 *     tool comment of that session) is the solver's own and is ignored;
 *   - an edit by a bot account is never human feedback;
 *   - everything else is reported with its evidence (time, editor, diff excerpt).
 */

import { AI_WORK_SESSION_RESUMED_MARKER, AI_WORK_SESSION_STARTED_MARKER, AUTO_RESTART_ON_LIMIT_RESET_MARKER, AUTO_RESUME_ON_LIMIT_RESET_MARKER, INTERACTIVE_SESSION_STARTED_MARKER, isToolGeneratedComment, isToolTrackedCommentId } from './tool-comments.lib.mjs';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

// The solver may still update the pull request body after its last comment
// (log upload, "Ready to merge"); allow a few minutes of slack.
export const SESSION_WINDOW_TRAILING_GRACE_MS = 5 * 60 * 1000;
// A preparatory edit may land slightly before the session-start comment.
export const SESSION_WINDOW_LEADING_GRACE_MS = 60 * 1000;

const SESSION_START_MARKERS = [AI_WORK_SESSION_STARTED_MARKER, AI_WORK_SESSION_RESUMED_MARKER, AUTO_RESUME_ON_LIMIT_RESET_MARKER, AUTO_RESTART_ON_LIMIT_RESET_MARKER, INTERACTIVE_SESSION_STARTED_MARKER];
// "## 🔄 Auto-restart 2/5" starts a new AI iteration; the "-until-mergeable Log" comment ends one.
const AUTO_RESTART_NOTICE_PATTERN = /🔄\s*Auto-restart(?!-until-mergeable)/;

const toTime = value => {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const isToolComment = comment => isToolTrackedCommentId(comment?.id) || isToolGeneratedComment(comment?.body);

/** True when a tool comment opens a new solver session (or AI iteration). */
export const isSessionStartComment = body => {
  if (!body || typeof body !== 'string' || !isToolGeneratedComment(body)) return false;
  return SESSION_START_MARKERS.some(marker => body.includes(marker)) || AUTO_RESTART_NOTICE_PATTERN.test(body);
};

/**
 * Time windows in which the solver itself was working, derived from the tool
 * comments it posted on the pull request. Window i runs from session-start
 * comment i to the last tool comment before session-start comment i+1. The
 * session that created the pull request posts no start comment, so `openedAt`
 * opens the first window. A window with no closing tool comment yet (e.g. a
 * pull request this very run created seconds ago) still covers the trailing
 * grace period after its start.
 *
 * @param {Array<{id?: number|string, created_at?: string, createdAt?: string, body?: string}>} comments
 * @param {{openedAt?: string|Date|null, leadingGraceMs?: number, trailingGraceMs?: number}} [options]
 * @returns {Array<{start: number, end: number, startedBy: string}>} epoch-ms windows, sorted
 */
export const buildSolverSessionWindows = (comments = [], { openedAt = null, leadingGraceMs = SESSION_WINDOW_LEADING_GRACE_MS, trailingGraceMs = SESSION_WINDOW_TRAILING_GRACE_MS } = {}) => {
  const toolComments = (Array.isArray(comments) ? comments : [])
    .filter(isToolComment)
    .map(comment => ({ time: toTime(comment.created_at || comment.createdAt), body: comment.body || '' }))
    .filter(comment => comment.time !== null)
    .sort((a, b) => a.time - b.time);

  const windows = [];
  const openedTime = toTime(openedAt);
  let current = openedTime !== null ? { start: openedTime, end: openedTime, startedBy: 'pull request created' } : null;
  for (const comment of toolComments) {
    if (isSessionStartComment(comment.body)) {
      if (current) windows.push(current);
      const firstLine = comment.body.split('\n').find(line => line.trim()) || '';
      current = { start: comment.time, end: comment.time, startedBy: firstLine.replace(/^#+\s*/, '').trim() };
    } else if (current) {
      current.end = comment.time;
    }
  }
  if (current) windows.push(current);
  return windows.map(window => ({ ...window, start: window.start - leadingGraceMs, end: window.end + trailingGraceMs }));
};

export const findSolverSessionWindow = (time, windows = []) => {
  if (time === null || time === undefined) return null;
  return windows.find(window => time >= window.start && time <= window.end) || null;
};

/**
 * Short line-based diff summary between two versions of a body.
 * @returns {{added: number, removed: number, excerpt: string}|null}
 */
export const summarizeBodyDiff = (before, after, maxExcerpt = 120) => {
  if (typeof before !== 'string' || typeof after !== 'string') return null;
  const split = text => text.replace(/\r\n/g, '\n').split('\n');
  const remaining = new Map();
  for (const line of split(before)) remaining.set(line, (remaining.get(line) || 0) + 1);
  const addedLines = [];
  for (const line of split(after)) {
    const count = remaining.get(line) || 0;
    if (count > 0) remaining.set(line, count - 1);
    else addedLines.push(line);
  }
  const removedLines = [...remaining.entries()].flatMap(([line, count]) => Array(count).fill(line));
  const clip = text => (text.length > maxExcerpt ? `${text.slice(0, maxExcerpt)}…` : text);
  const firstAdded = addedLines.find(line => line.trim());
  const firstRemoved = removedLines.find(line => line.trim());
  const excerpt = firstAdded !== undefined ? `+ ${clip(firstAdded.trim())}` : firstRemoved !== undefined ? `- ${clip(firstRemoved.trim())}` : '';
  return { added: addedLines.length, removed: removedLines.length, excerpt };
};

const isBotActor = actor => Boolean(actor) && (actor.__typename === 'Bot' || /\[bot\]$/i.test(actor.login || ''));

const EDIT_FIELDS = `createdAt
        userContentEdits(first: 50) { nodes { editedAt editor { __typename login } diff } }
        timelineItems(last: 50, itemTypes: [RENAMED_TITLE_EVENT]) { nodes { ... on RenamedTitleEvent { createdAt actor { __typename login } previousTitle currentTitle } } }`;

export const CONTENT_EDITS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        ${EDIT_FIELDS}
      }
      ... on PullRequest {
        ${EDIT_FIELDS}
      }
    }
  }
}`;

/**
 * Flatten the GraphQL node into a newest-first list of edits. `userContentEdits`
 * nodes are newest first and each `diff` is the body as saved by that edit, so
 * the previous body is the next node's `diff`. The oldest node is the original
 * body (editedAt === createdAt), not an edit.
 */
export const parseContentEdits = node => {
  if (!node || typeof node !== 'object') return [];
  const edits = [];
  const createdAt = toTime(node.createdAt);
  const bodyNodes = (node.userContentEdits?.nodes || []).filter(Boolean);
  bodyNodes.forEach((item, index) => {
    const editedAt = toTime(item.editedAt);
    if (editedAt === null) return;
    const previous = bodyNodes[index + 1];
    if (!previous && createdAt !== null && Math.abs(editedAt - createdAt) < 1000) return;
    edits.push({ field: 'body', editedAt: new Date(editedAt).toISOString(), editor: item.editor?.login || null, isBot: isBotActor(item.editor), diffSummary: previous ? summarizeBodyDiff(previous.diff, item.diff) : null });
  });
  for (const event of node.timelineItems?.nodes || []) {
    const editedAt = toTime(event?.createdAt);
    if (editedAt === null) continue;
    edits.push({ field: 'title', editedAt: new Date(editedAt).toISOString(), editor: event.actor?.login || null, isBot: isBotActor(event.actor), diffSummary: null, from: event.previousTitle ?? '', to: event.currentTitle ?? '' });
  }
  return edits.sort((a, b) => toTime(b.editedAt) - toTime(a.editedAt));
};

/** @returns {Promise<{ok: boolean, edits: Array, createdAt?: string|null, error?: string}>} */
export const fetchContentEdits = async ({ owner, repo, number, $ }) => {
  try {
    const result = await ghWithRateLimitRetry(() => $`gh api graphql -f query=${CONTENT_EDITS_QUERY} -f owner=${owner} -f repo=${repo} -F number=${number}`, { label: 'fetchContentEdits' });
    if (result.code !== 0) return { ok: false, edits: [], error: (result.stderr?.toString() || '').trim() || `exit code ${result.code}` };
    const node = JSON.parse(result.stdout?.toString() || '{}')?.data?.repository?.issueOrPullRequest;
    if (!node) return { ok: false, edits: [], error: 'no issueOrPullRequest in GraphQL response' };
    return { ok: true, createdAt: node.createdAt || null, edits: parseContentEdits(node) };
  } catch (error) {
    return { ok: false, edits: [], error: error?.message || String(error) };
  }
};

/**
 * Split edits made after `since` into external (human feedback) and ignored
 * (with the reason). Edits after `until` (the current work start) belong to the
 * current session. Only the solver's own account can make solver edits, so
 * another person editing inside a session window is still feedback.
 *
 * @returns {{external: Array, ignored: Array<{edit: Object, reason: string}>}}
 */
export const classifyContentEdits = ({ edits = [], since, until = null, windows = [], currentUser = null }) => {
  const sinceTime = toTime(since);
  const untilTime = toTime(until);
  const external = [];
  const ignored = [];
  for (const edit of edits) {
    const time = toTime(edit.editedAt);
    if (time === null || (sinceTime !== null && time <= sinceTime)) continue;
    if (untilTime !== null && time > untilTime) {
      ignored.push({ edit, reason: 'made during the current work session' });
      continue;
    }
    if (edit.isBot) {
      ignored.push({ edit, reason: `made by bot ${edit.editor}` });
      continue;
    }
    const sameAccount = !currentUser || !edit.editor || edit.editor === currentUser;
    const window = sameAccount ? findSolverSessionWindow(time, windows) : null;
    if (window) {
      ignored.push({ edit, reason: `made inside a solver session (${new Date(window.start + SESSION_WINDOW_LEADING_GRACE_MS).toISOString()} "${window.startedBy}")` });
      continue;
    }
    external.push(edit);
  }
  return { external, ignored };
};

/** One-line human readable evidence for an edit. */
export const formatEditEvidence = edit => {
  const who = edit.editor ? `by ${edit.editor}` : 'by unknown editor';
  if (edit.field === 'title') return `title edited at ${edit.editedAt} ${who}: "${edit.from}" → "${edit.to}"`;
  const summary = edit.diffSummary;
  const diffText = summary ? `: +${summary.added}/-${summary.removed} lines${summary.excerpt ? ` (${summary.excerpt})` : ''}` : '';
  return `description edited at ${edit.editedAt} ${who}${diffText}`;
};

/**
 * Fetch and classify the edits of one issue/pull request. `comments` are the
 * pull request conversation comments (where the solver posts its session
 * markers); `openedAt` defaults to the fetched item's own creation time.
 */
export const detectExternalContentEdits = async ({ owner, repo, number, since, until = null, comments = [], currentUser = null, openedAt = undefined, $ }) => {
  const fetched = await fetchContentEdits({ owner, repo, number, $ });
  if (!fetched.ok) return { ok: false, error: fetched.error, external: [], ignored: [] };
  const windows = buildSolverSessionWindows(comments, { openedAt: openedAt === undefined ? fetched.createdAt : openedAt });
  const { external, ignored } = classifyContentEdits({ edits: fetched.edits, since, until, windows, currentUser });
  return { ok: true, createdAt: fetched.createdAt, external, ignored, windows };
};
