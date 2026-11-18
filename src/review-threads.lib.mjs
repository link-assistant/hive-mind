#!/usr/bin/env node
/**
 * Issue #4082 (cases 1, 2, 4, 5): unresolved pull request review threads.
 *
 * A review finding lives in a review *thread*. Its comments may be older than
 * the last commit, and their author may be a review bot such as
 * `chatgpt-codex-connector[bot]`. Before this module:
 *   - session-start feedback counted review comments only when they were newer
 *     than the last commit (`solve.feedback.lib.mjs`), so a later push, even a
 *     merge of the default branch, hid a finding that was still open (case 4);
 *   - the `--auto-restart-until-mergeable` loop ignored every `[bot]` login,
 *     so "Ready to merge" was posted on top of a fresh P1 finding (case 1);
 *   - a thread that the AI had answered with "Fixed in <sha>" but never
 *     resolved looked exactly like an unanswered one (case 5).
 *
 * GitHub tracks `isResolved` per thread, whatever the age or author of its
 * comments, so that state is the one readiness signal used here.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 */

import { promptText } from './prompt-text.lib.mjs';
import { isToolGeneratedComment } from './tool-comments.lib.mjs';
import { stripHtmlComments } from './merge-prerequisites.lib.mjs';

// `first: 100` is the GraphQL maximum. Only the first comment of each thread is
// needed: it holds the finding, and its author is the thread's author.
export const REVIEW_THREADS_QUERY = 'query($owner: String!, $repo: String!, $number: Int!, $after: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id isResolved isOutdated path line originalLine comments(first: 1) { totalCount nodes { databaseId author { login } body url createdAt } } } } } } }';

// The mutation the AI runs after a verified fix (case 5). `$id` is a GraphQL
// variable, so the shell command needs no escaping of the thread id.
export const RESOLVE_REVIEW_THREAD_COMMAND = "gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }' -f id=THREAD_ID";

const MAX_PAGES = 20;
const EXCERPT_LENGTH = 160;

const normalizeThread = node => {
  const first = node?.comments?.nodes?.[0] || {};
  return {
    id: node?.id || null,
    isResolved: node?.isResolved === true,
    isOutdated: node?.isOutdated === true,
    path: node?.path || null,
    line: node?.line ?? node?.originalLine ?? null,
    commentCount: node?.comments?.totalCount ?? (first.body ? 1 : 0),
    author: first.author?.login || 'ghost',
    body: typeof first.body === 'string' ? first.body : '',
    url: first.url || null,
    createdAt: first.createdAt || null,
    commentId: first.databaseId ?? null,
  };
};

/**
 * Read every review thread of a pull request.
 *
 * @param {Object} params
 * @param {Function} params.commandRunner - tagged-template runner returning `{ code, stdout, stderr }`
 * @returns {Promise<{ ok: boolean, threads: Array, error?: string }>} `ok` is false when GitHub could not be asked;
 *   callers must then treat the thread state as unknown, never as "no threads".
 */
export const fetchReviewThreads = async ({ owner, repo, prNumber, commandRunner, maxPages = MAX_PAGES }) => {
  const threads = [];
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    let result;
    try {
      result = after ? await commandRunner`gh api graphql -f ${`query=${REVIEW_THREADS_QUERY}`} -f ${`owner=${owner}`} -f ${`repo=${repo}`} -F ${`number=${prNumber}`} -f ${`after=${after}`}` : await commandRunner`gh api graphql -f ${`query=${REVIEW_THREADS_QUERY}`} -f ${`owner=${owner}`} -f ${`repo=${repo}`} -F ${`number=${prNumber}`}`;
    } catch (error) {
      return { ok: false, threads, error: error?.message || String(error) };
    }
    if (result?.code !== 0) return { ok: false, threads, error: (result?.stderr || result?.stdout || '').toString().trim() || `exit code ${result?.code}` };
    let data;
    try {
      data = JSON.parse(result.stdout.toString() || '{}');
    } catch (error) {
      return { ok: false, threads, error: `unparseable GraphQL answer: ${error.message}` };
    }
    const connection = data?.data?.repository?.pullRequest?.reviewThreads;
    if (!connection) return { ok: false, threads, error: data?.errors?.[0]?.message || 'no reviewThreads in the GraphQL answer' };
    threads.push(...(connection.nodes || []).map(normalizeThread));
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo?.endCursor) return { ok: true, threads };
    after = connection.pageInfo.endCursor;
  }
  return { ok: true, threads, truncated: true };
};

/** Threads still waiting for a fix, whatever their age or author. Threads opened by hive-mind's own status comments are skipped. */
export const selectUnresolvedReviewThreads = threads => (threads || []).filter(thread => thread && thread.id && !thread.isResolved && !isToolGeneratedComment(thread.body));

/** Unresolved review threads of a pull request; `ok: false` when GitHub could not be asked. */
export const fetchUnresolvedReviewThreads = async params => {
  const result = await fetchReviewThreads(params);
  return { ...result, threads: selectUnresolvedReviewThreads(result.threads) };
};

const excerpt = body => {
  const flat = stripHtmlComments(body).replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}...` : flat;
};

export const describeThreadLocation = thread => (thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ''}` : 'the pull request');

/**
 * Prompt lines that list unresolved threads and say how to close them (case 5):
 * fix, verify, reply, then resolve. The thread id is printed so the AI can run
 * the mutation without another lookup.
 */
export const buildUnresolvedReviewThreadLines = (threads, { maxItems = 25 } = {}) => {
  if (!threads || threads.length === 0) return [];
  const lines = [promptText('prompt.templates.review-threads.feedback.header', { count: String(threads.length) })];
  for (const thread of threads.slice(0, maxItems)) {
    lines.push(
      promptText('prompt.templates.review-threads.feedback.item', {
        author: thread.author,
        location: describeThreadLocation(thread),
        outdated: thread.isOutdated ? promptText('prompt.templates.review-threads.feedback.outdated') : '',
        excerpt: excerpt(thread.body),
        url: thread.url || 'no URL',
        threadId: thread.id,
      })
    );
  }
  if (threads.length > maxItems) lines.push(promptText('prompt.templates.review-threads.feedback.more', { count: String(threads.length - maxItems) }));
  lines.push(promptText('prompt.templates.review-threads.feedback.instruction', { command: RESOLVE_REVIEW_THREAD_COMMAND }));
  return lines;
};

/** Markdown list items for a status comment that names the threads holding a pull request back. */
export const formatThreadsForComment = (threads, { maxItems = 10 } = {}) => {
  const items = (threads || []).slice(0, maxItems).map(thread => `- ${thread.url ? `[${thread.author} on \`${describeThreadLocation(thread)}\`](${thread.url})` : `${thread.author} on \`${describeThreadLocation(thread)}\``}${thread.isOutdated ? ' (outdated)' : ''}`);
  if ((threads || []).length > maxItems) items.push(`- …and ${threads.length - maxItems} more`);
  return items;
};

/**
 * Remembers which unresolved threads were already handed to an AI session.
 *
 * A thread seen for the first time restarts the AI with the finding. A thread
 * the AI already received but left unresolved (it disagreed, or the account
 * cannot resolve threads) does not buy another restart: it holds "Ready to
 * merge" back and is named in the status comment for a human instead. This
 * keeps the gate from spending the whole restart budget on one thread.
 */
export const createReviewThreadTracker = () => {
  const reported = new Set();
  return {
    split(threads) {
      const fresh = [];
      const alreadyReported = [];
      for (const thread of threads || []) (reported.has(thread.id) ? alreadyReported : fresh).push(thread);
      return { fresh, alreadyReported };
    },
    markReported(threads) {
      for (const thread of threads || []) if (thread?.id) reported.add(thread.id);
    },
    get size() {
      return reported.size;
    },
  };
};

export default {
  REVIEW_THREADS_QUERY,
  RESOLVE_REVIEW_THREAD_COMMAND,
  fetchReviewThreads,
  fetchUnresolvedReviewThreads,
  selectUnresolvedReviewThreads,
  buildUnresolvedReviewThreadLines,
  formatThreadsForComment,
  describeThreadLocation,
  createReviewThreadTracker,
};
