/**
 * Issue #2293: detect *real* human edits of a pull request / issue title and
 * description, with evidence.
 *
 * Before this module, solve.feedback.lib.mjs treated `updated_at > last commit`
 * as "description was edited". `updated_at` is bumped by comments, labels,
 * draft/ready conversions and cross-references, and when the description *was*
 * edited it usually was the previous AI session updating its own pull request
 * description. The solver and the human share one GitHub login, so the login
 * alone cannot tell the two apart. Every one of those cases was reported as
 * human feedback and triggered a restart.
 *
 * This module answers the question from GitHub's edit history instead:
 *   - description edits come from `userContentEdits` (one node per saved body,
 *     `diff` holds the body as saved by that edit);
 *   - title edits come from `RenamedTitleEvent` timeline items;
 *   - an edit made inside a known solver session window (between a session
 *     start marker comment and the last tool comment of that session) is the
 *     solver's own edit and is ignored;
 *   - an edit by a bot account is never human feedback;
 *   - everything else is reported together with its evidence (timestamp,
 *     editor, diff excerpt), so false positives can be verified at a glance.
 */

import { AI_WORK_SESSION_RESUMED_MARKER, AI_WORK_SESSION_STARTED_MARKER, AUTO_RESTART_ON_LIMIT_RESET_MARKER, AUTO_RESUME_ON_LIMIT_RESET_MARKER, INTERACTIVE_SESSION_STARTED_MARKER, isToolGeneratedComment, isToolTrackedCommentId } from './tool-comments.lib.mjs';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

// The solver finishes a session with a log upload and then may still update
// the pull request body (e.g. "Fixes #N" link) and post "Ready to merge".
// Observed gaps between the last tool comment and the solver's final edit are
// a few seconds; allow a few minutes of slack.
export const SESSION_WINDOW_TRAILING_GRACE_MS = 5 * 60 * 1000;
// The session-start comment is posted right after the session starts; a
// preparatory edit may land slightly before it.
export const SESSION_WINDOW_LEADING_GRACE_MS = 60 * 1000;

const SESSION_START_MARKERS = [AI_WORK_SESSION_STARTED_MARKER, AI_WORK_SESSION_RESUMED_MARKER, AUTO_RESUME_ON_LIMIT_RESET_MARKER, AUTO_RESTART_ON_LIMIT_RESET_MARKER, INTERACTIVE_SESSION_STARTED_MARKER];
// "## 🔄 Auto-restart 2/5" starts a new AI iteration; "## 🔄 Auto-restart-until-mergeable Log 2/5"
// ends one and "## ❌ Auto-restart 5/5 - limit reached" ends the loop.
const AUTO_RESTART_NOTICE_PATTERN = /🔄\s*Auto-restart(?!-until-mergeable)/;

const toTime = value => {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const isToolComment = comment => isToolTrackedCommentId(comment?.id) || isToolGeneratedComment(comment?.body);

/**
 * True when a tool comment opens a new solver session (or AI iteration).
 * @param {string} body
 */
export const isSessionStartComment = body => {
  if (!body || typeof body !== 'string') return false;
  if (!isToolGeneratedComment(body)) return false;
  return SESSION_START_MARKERS.some(marker => body.includes(marker)) || AUTO_RESTART_NOTICE_PATTERN.test(body);
};

/**
 * Derive the time windows in which the solver itself was working, from the
 * tool comments it posted on the pull request.
 *
 * Window i starts at session-start comment i and ends at the last tool comment
 * posted before session-start comment i+1 (or the last tool comment overall
 * for the final session). Human comments inside a window do not end it: the
 * solver keeps running while people comment.
 *
 * The session that creates the pull request posts no start comment - the pull
 * request itself is its start. When tool comments (e.g. "Solution Draft Log")
 * precede the first start comment, that first session is taken to run from
 * `openedAt` (the pull request creation time) to the last of those comments.
 *
 * @param {Array<{id?: number|string, created_at?: string, createdAt?: string, body?: string}>} comments
 * @param {{ openedAt?: string|Date|null, leadingGraceMs?: number, trailingGraceMs?: number }} [options]
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
  let current = openedTime !== null ? { start: openedTime, end: null, startedBy: 'pull request created' } : null;
  for (const comment of toolComments) {
    if (isSessionStartComment(comment.body)) {
      if (current && current.end !== null) windows.push(current);
      const firstLine = comment.body.split('\n').find(line => line.trim()) || '';
      current = { start: comment.time, end: comment.time, startedBy: firstLine.replace(/^#+\s*/, '').trim() };
    } else if (current) {
      current.end = comment.time;
    }
  }
  if (current && current.end !== null) windows.push(current);

  return windows.map(window => ({ ...window, start: window.start - leadingGraceMs, end: window.end + trailingGraceMs }));
};

/**
 * @param {number|null} time epoch ms
 * @param {Array<{start: number, end: number}>} windows
 */
export const findSolverSessionWindow = (time, windows = []) => {
  if (time === null || time === undefined) return null;
  return windows.find(window => time >= window.start && time <= window.end) || null;
};

/**
 * Short line-based diff summary between two versions of a body.
 * @param {string|null} before
 * @param {string|null} after
 * @param {number} [maxExcerpt=120]
 * @returns {{added: number, removed: number, excerpt: string}|null}
 */
export const summarizeBodyDiff = (before, after, maxExcerpt = 120) => {
  if (typeof before !== 'string' || typeof after !== 'string') return null;
  const normalize = text => text.replace(/\r\n/g, '\n').split('\n');
  const beforeLines = normalize(before);
  const afterLines = normalize(after);
  const beforeCounts = new Map();
  for (const line of beforeLines) beforeCounts.set(line, (beforeCounts.get(line) || 0) + 1);
  const addedLines = [];
  for (const line of afterLines) {
    const count = beforeCounts.get(line) || 0;
    if (count > 0) beforeCounts.set(line, count - 1);
    else addedLines.push(line);
  }
  const removed = [...beforeCounts.values()].reduce((sum, count) => sum + count, 0);
  const firstRemoved = beforeLines.find(line => {
    const afterCount = afterLines.filter(other => other === line).length;
    const beforeCount = beforeLines.filter(other => other === line).length;
    return beforeCount > afterCount && line.trim();
  });
  const firstAdded = addedLines.find(line => line.trim());
  const clip = text => (text.length > maxExcerpt ? `${text.slice(0, maxExcerpt)}…` : text);
  const excerpt = firstAdded !== undefined ? `+ ${clip(firstAdded.trim())}` : firstRemoved !== undefined ? `- ${clip(firstRemoved.trim())}` : '';
  return { added: addedLines.length, removed, excerpt };
};

const isBotActor = actor => {
  if (!actor) return false;
  return actor.__typename === 'Bot' || /\[bot\]$/i.test(actor.login || '');
};

export const CONTENT_EDITS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        createdAt
        lastEditedAt
        userContentEdits(first: 50) { totalCount nodes { editedAt editor { __typename login } diff } }
        timelineItems(last: 50, itemTypes: [RENAMED_TITLE_EVENT]) { nodes { ... on RenamedTitleEvent { createdAt actor { __typename login } previousTitle currentTitle } } }
      }
      ... on PullRequest {
        createdAt
        lastEditedAt
        userContentEdits(first: 50) { totalCount nodes { editedAt editor { __typename login } diff } }
        timelineItems(last: 50, itemTypes: [RENAMED_TITLE_EVENT]) { nodes { ... on RenamedTitleEvent { createdAt actor { __typename login } previousTitle currentTitle } } }
      }
    }
  }
}`;

/**
 * Turn the GraphQL payload into a flat, newest-first list of edits.
 * `userContentEdits` nodes are newest first and each `diff` is the body as
 * saved by that edit, so the previous body is the next node's `diff`. The
 * oldest node is the original body (editedAt === createdAt), not an edit.
 *
 * @param {Object} node - `issueOrPullRequest` GraphQL node
 * @returns {Array<{field: 'title'|'body', editedAt: string, editor: string|null, isBot: boolean, diffSummary: Object|null, from?: string, to?: string}>}
 */
export const parseContentEdits = node => {
  if (!node || typeof node !== 'object') return [];
  const edits = [];
  const createdAt = toTime(node.createdAt);
  const bodyNodes = (node.userContentEdits?.nodes || []).filter(Boolean);
  bodyNodes.forEach((edit, index) => {
    const editedAt = toTime(edit.editedAt);
    if (editedAt === null) return;
    const previous = bodyNodes[index + 1];
    // The oldest node is the original content, recorded when it was created.
    if (!previous && createdAt !== null && Math.abs(editedAt - createdAt) < 1000) return;
    edits.push({
      field: 'body',
      editedAt: new Date(editedAt).toISOString(),
      editor: edit.editor?.login || null,
      isBot: isBotActor(edit.editor),
      diffSummary: previous ? summarizeBodyDiff(previous.diff, edit.diff) : null,
    });
  });
  for (const event of node.timelineItems?.nodes || []) {
    const editedAt = toTime(event?.createdAt);
    if (editedAt === null) continue;
    edits.push({
      field: 'title',
      editedAt: new Date(editedAt).toISOString(),
      editor: event.actor?.login || null,
      isBot: isBotActor(event.actor),
      diffSummary: null,
      from: event.previousTitle ?? '',
      to: event.currentTitle ?? '',
    });
  }
  return edits.sort((a, b) => toTime(b.editedAt) - toTime(a.editedAt));
};

/**
 * Fetch title/description edit history of an issue or pull request.
 * @returns {Promise<{ok: boolean, edits: Array, error?: string}>}
 */
export const fetchContentEdits = async ({ owner, repo, number, $ }) => {
  try {
    const result = await ghWithRateLimitRetry(() => $`gh api graphql -f query=${CONTENT_EDITS_QUERY} -f owner=${owner} -f repo=${repo} -F number=${number}`, { label: 'fetchContentEdits' });
    if (result.code !== 0) {
      return { ok: false, edits: [], error: (result.stderr || '').toString().trim() || `exit code ${result.code}` };
    }
    const payload = JSON.parse(result.stdout.toString() || '{}');
    const node = payload?.data?.repository?.issueOrPullRequest;
    if (!node) return { ok: false, edits: [], error: 'no issueOrPullRequest in GraphQL response' };
    return { ok: true, createdAt: node.createdAt || null, edits: parseContentEdits(node) };
  } catch (error) {
    return { ok: false, edits: [], error: error?.message || String(error) };
  }
};

/**
 * Split edits into external (human feedback) and ignored (with the reason).
 *
 * @param {Object} params
 * @param {Array} params.edits - from parseContentEdits()
 * @param {Date|string|number} params.since - only edits after this count (last commit time)
 * @param {Date|string|number|null} [params.until] - edits after this are the current session's own (work start time)
 * @param {Array} [params.windows] - from buildSolverSessionWindows()
 * @param {string|null} [params.currentUser] - login the solver runs as; edits by any other human are always external
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
    // Only the solver's own account can make solver edits; another person
    // editing during a session is still feedback.
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

/**
 * One-line human readable evidence for an edit.
 * @param {Object} edit
 */
export const formatEditEvidence = edit => {
  const who = edit.editor ? `by ${edit.editor}` : 'by unknown editor';
  if (edit.field === 'title') {
    return `title edited at ${edit.editedAt} ${who}: "${edit.from}" → "${edit.to}"`;
  }
  const summary = edit.diffSummary;
  const diffText = summary ? `: +${summary.added}/-${summary.removed} lines${summary.excerpt ? ` (${summary.excerpt})` : ''}` : '';
  return `description edited at ${edit.editedAt} ${who}${diffText}`;
};

/**
 * Fetch and classify edits of one issue/pull request in a single call.
 * `comments` are the pull request conversation comments (where the solver
 * posts its session markers); `openedAt` is the pull request creation time
 * (defaults to the fetched item's own creation time).
 */
export const detectExternalContentEdits = async ({ owner, repo, number, since, until = null, comments = [], currentUser = null, openedAt = undefined, $ }) => {
  const fetched = await fetchContentEdits({ owner, repo, number, $ });
  if (!fetched.ok) return { ok: false, error: fetched.error, external: [], ignored: [] };
  const windows = buildSolverSessionWindows(comments, { openedAt: openedAt === undefined ? fetched.createdAt : openedAt });
  const { external, ignored } = classifyContentEdits({ edits: fetched.edits, since, until, windows, currentUser });
  return { ok: true, createdAt: fetched.createdAt, external, ignored, windows };
};

export default {
  buildSolverSessionWindows,
  classifyContentEdits,
  detectExternalContentEdits,
  fetchContentEdits,
  findSolverSessionWindow,
  formatEditEvidence,
  isSessionStartComment,
  parseContentEdits,
  summarizeBodyDiff,
};
