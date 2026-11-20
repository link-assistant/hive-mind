#!/usr/bin/env node
/**
 * Issue #4081: automated pull request reviewers ("review bots").
 *
 * Review apps such as the ChatGPT Codex connector (`chatgpt-codex-connector[bot]`)
 * and CodeRabbit (`coderabbitai[bot]`) start when a pull request is opened or
 * marked ready for review, and again on later pushes. Hive Mind marks the pull
 * request ready at the end of a session, so their findings usually arrive one
 * to three minutes after the AI stopped. Before this module:
 *   - `checkForNonBotComments` dropped every `[bot]` login, review apps
 *     included, so their comments and reviews were never feedback;
 *   - "Ready to merge" was posted (or the pull request merged) while a review
 *     app was still reviewing the head commit;
 *   - the Codex connector's own "has unresolved findings" signal was ignored.
 *
 * This module knows which logins are review apps (a configurable allowlist,
 * `--review-bots`), reads what they say about the head commit, and tells the
 * watch loop whether to wait for them and whether they reported findings.
 * CI and deploy bots (dependabot, renovate, codecov, netlify, vercel,
 * github-actions, …) are not on the list and stay ignored.
 *
 * Every GitHub read fails open: when the state cannot be read, the loop neither
 * waits nor holds the pull request back.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4081
 */

import { promptText } from './prompt-text.lib.mjs';
import { stripHtmlComments } from './merge-prerequisites.lib.mjs';
import { DEFAULT_REVIEW_BOTS, DEFAULT_REVIEW_BOTS_WAIT_MINUTES, REVIEW_BOTS_START_GRACE_MINUTES, createReviewBotMatcher, normalizeBotLogin, parseReviewBotsOption } from './review-bots-options.lib.mjs';

export { DEFAULT_REVIEW_BOTS, DEFAULT_REVIEW_BOTS_WAIT_MINUTES, REVIEW_BOTS_START_GRACE_MINUTES, createReviewBotMatcher, normalizeBotLogin, parseReviewBotsOption };

/**
 * The Codex connector's machine-readable summary state:
 * `<!-- codex-review-state:v1 {"has_unresolved_findings":true,...} -->`.
 * Returns the parsed object, or `null` when there is no valid marker.
 */
export const parseCodexReviewState = body => {
  const match = /<!--\s*codex-review-state:v1\s+([\s\S]*?)\s*-->/i.exec(String(body || ''));
  if (!match) return null;
  try {
    const state = JSON.parse(match[1]);
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch {
    return null;
  }
};

// Checked against the raw body: CodeRabbit keeps its "review in progress"
// marker inside an HTML comment.
const IN_PROGRESS_PATTERNS = [/review in progress/i, /currently processing new changes/i, /\breviewing (?:your|this) (?:pull request|PR|changes)\b/i, /\breview (?:is )?(?:queued|running|underway)\b/i];
const NO_FINDINGS_PATTERNS = [/didn['’]?t find any (?:major |new )?(?:issues|problems)/i, /\bno (?:new |major )?(?:issues|problems|findings) (?:were )?found\b/i, /\bfound no (?:new |major )?(?:issues|problems)\b/i, /\bLGTM\b/];
const ACTIONABLE_COUNT_PATTERN = /actionable comments posted:\s*\**\s*(\d+)/i;
const RUNNING_STATUS_PATTERN = /^(?:running|in[_ -]?progress|pending|queued|started|reviewing)$/i;

/**
 * What a review app's comment or review body says:
 * `findings`, `no_findings`, `in_progress` or `unknown` (a walkthrough, a
 * summary, a notice: none of them is a finding by itself).
 *
 * Assumption (documented in docs/case-studies/issue-4081): the Codex marker
 * may carry a `status` or `state` field while the review runs; only
 * `has_unresolved_findings` is relied on for the outcome.
 */
export const reviewBotSignal = body => {
  const text = String(body || '');
  const state = parseCodexReviewState(text);
  if (state) {
    const status = String(state.status ?? state.state ?? '').trim();
    if (status && RUNNING_STATUS_PATTERN.test(status)) return 'in_progress';
    if (state.has_unresolved_findings === true) return 'findings';
    if (state.has_unresolved_findings === false) return 'no_findings';
  }
  const actionable = ACTIONABLE_COUNT_PATTERN.exec(text);
  if (actionable) return Number(actionable[1]) > 0 ? 'findings' : 'no_findings';
  if (IN_PROGRESS_PATTERNS.some(pattern => pattern.test(text))) return 'in_progress';
  if (NO_FINDINGS_PATTERNS.some(pattern => pattern.test(stripHtmlComments(text)))) return 'no_findings';
  return 'unknown';
};

/**
 * Whether a review app's REST comment is feedback for the restart loop.
 *
 * - `issue_comment` (conversation): only when it reports findings (the Codex
 *   summary marker, CodeRabbit's "Actionable comments posted: N"). Walkthroughs,
 *   summaries, "review started" and rate-limit notices are not feedback.
 * - `review`: `CHANGES_REQUESTED`, or a body that reports findings (CodeRabbit
 *   keeps "outside diff range" and nitpick findings in the review body only).
 * - `review_comment` (inline): a top-level finding, but only when
 *   `countInline` is set. By default inline findings are review threads and
 *   the unresolved-thread gate (#4082) restarts on them, so counting them here
 *   too would report every finding twice. Replies inside a thread never count,
 *   so a bot's "thanks, looks fixed" reply cannot buy a restart.
 */
export const isReviewBotFeedback = (kind, comment, { countInline = false } = {}) => {
  const signal = reviewBotSignal(comment?.body);
  if (kind === 'issue_comment') return signal === 'findings';
  if (kind === 'review_comment') return countInline && !comment?.in_reply_to_id && signal !== 'in_progress' && Boolean(String(comment?.body || '').trim());
  if (kind === 'review') {
    const state = String(comment?.state || comment?.review_state || '').toUpperCase();
    return state === 'CHANGES_REQUESTED' || signal === 'findings';
  }
  return false;
};

// Comments, reviews and the head commit of the pull request in one GraphQL
// call. Reactions are read over REST, because a GraphQL `Reaction.user` is a
// `User` and comes back `null` for GitHub Apps.
export const REVIEW_BOT_ACTIVITY_QUERY = 'query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { headRefOid isDraft commits(last: 1) { nodes { commit { oid committedDate } } } timelineItems(last: 50, itemTypes: [READY_FOR_REVIEW_EVENT, HEAD_REF_FORCE_PUSHED_EVENT]) { nodes { __typename ... on ReadyForReviewEvent { createdAt } ... on HeadRefForcePushedEvent { createdAt } } } comments(last: 100) { nodes { id databaseId url author { login } body createdAt updatedAt } } reviews(last: 100) { nodes { id databaseId url author { login } state body submittedAt commit { oid } } } } } }';

const toTime = value => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};

/**
 * Read what review apps did on a pull request.
 * @returns {Promise<{ ok: boolean, activity?: Object, error?: string }>}
 */
export const fetchReviewBotActivity = async ({ owner, repo, prNumber, commandRunner }) => {
  let result;
  try {
    result = await commandRunner`gh api graphql -f ${`query=${REVIEW_BOT_ACTIVITY_QUERY}`} -f ${`owner=${owner}`} -f ${`repo=${repo}`} -F ${`number=${prNumber}`}`;
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
  if (result?.code !== 0) return { ok: false, error: (result?.stderr?.toString() || result?.stdout?.toString() || '').trim() || `exit code ${result?.code}` };
  let data;
  try {
    data = JSON.parse(result.stdout.toString() || '{}');
  } catch (error) {
    return { ok: false, error: `unparseable GraphQL answer: ${error.message}` };
  }
  const pr = data?.data?.repository?.pullRequest;
  if (!pr) return { ok: false, error: data?.errors?.[0]?.message || 'no pullRequest in the GraphQL answer' };

  let reactions = [];
  try {
    const reactionsResult = await commandRunner`gh api repos/${owner}/${repo}/issues/${prNumber}/reactions --paginate`;
    if (reactionsResult?.code === 0) reactions = JSON.parse(reactionsResult.stdout.toString() || '[]');
  } catch {
    // Reactions only refine the picture (👀 while running, 👍 when clean).
  }

  const headCommit = pr.commits?.nodes?.[0]?.commit || null;
  return {
    ok: true,
    activity: {
      headSha: pr.headRefOid || headCommit?.oid || null,
      headCommittedAt: headCommit?.committedDate || null,
      timelineEvents: (pr.timelineItems?.nodes || []).map(node => ({ type: node?.__typename, createdAt: node?.createdAt || null })),
      comments: (pr.comments?.nodes || []).map(node => ({ id: node?.databaseId ?? node?.id, url: node?.url || null, login: node?.author?.login || null, body: node?.body || '', createdAt: node?.createdAt || null, updatedAt: node?.updatedAt || null })),
      reviews: (pr.reviews?.nodes || []).map(node => ({ id: node?.databaseId ?? node?.id, url: node?.url || null, login: node?.author?.login || null, state: node?.state || '', body: node?.body || '', submittedAt: node?.submittedAt || null, commitOid: node?.commit?.oid || null })),
      reactions: (Array.isArray(reactions) ? reactions : []).map(reaction => ({ login: reaction?.user?.login || null, content: reaction?.content || '', createdAt: reaction?.created_at || null })),
    },
  };
};

const excerptOf = body => {
  const flat = stripHtmlComments(body).replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}...` : flat;
};

/**
 * Decide, from {@link fetchReviewBotActivity}'s `activity`, whether review apps
 * are still reviewing the head commit and whether they reported findings on it.
 *
 * The head commit's review starts at the "anchor": the latest of the head
 * commit date, the last "ready for review" event and the last force push.
 *
 * - An app whose latest sign since the anchor is "in progress" (👀, a running
 *   summary) is waited for until `waitMinutes` after the anchor.
 * - An app that reviewed earlier commits but has shown nothing since the
 *   anchor is waited for `startGraceMinutes`: it may not re-review every push.
 * - An app that never appeared on the pull request is not waited for.
 *
 * @returns {{ anchor: number|null, pending: Array<{login, reason, deadline}>, remainingMs: number, findings: Array, timedOut: Array<string> }}
 */
export const evaluateReviewBotActivity = ({ activity, isReviewBot, now = Date.now(), waitMinutes = DEFAULT_REVIEW_BOTS_WAIT_MINUTES, startGraceMinutes = REVIEW_BOTS_START_GRACE_MINUTES, fallbackAnchor = null } = {}) => {
  const empty = { anchor: null, pending: [], remainingMs: 0, findings: [], timedOut: [] };
  if (!activity || typeof isReviewBot !== 'function') return empty;
  const anchorCandidates = [toTime(activity.headCommittedAt), ...(activity.timelineEvents || []).map(event => toTime(event.createdAt))].filter(time => time !== null);
  const anchor = anchorCandidates.length > 0 ? Math.max(...anchorCandidates) : toTime(fallbackAnchor);

  const bots = new Map();
  const add = (login, event) => {
    if (!isReviewBot(login)) return;
    const key = normalizeBotLogin(login);
    if (!bots.has(key)) bots.set(key, { login, events: [] });
    bots.get(key).events.push(event);
  };
  for (const comment of activity.comments || []) {
    const time = Math.max(toTime(comment.createdAt) ?? 0, toTime(comment.updatedAt) ?? 0) || null;
    add(comment.login, { kind: 'comment', time, signal: reviewBotSignal(comment.body), comment });
  }
  for (const review of activity.reviews || []) {
    const state = String(review.state || '').toUpperCase();
    if (state === 'PENDING') continue;
    add(review.login, { kind: 'review', time: toTime(review.submittedAt), signal: state === 'CHANGES_REQUESTED' ? 'findings' : 'done', forHead: Boolean(activity.headSha && review.commitOid === activity.headSha) });
  }
  for (const reaction of activity.reactions || []) {
    const content = String(reaction.content || '').toLowerCase();
    const signal = content === 'eyes' ? 'in_progress' : content === '+1' || content === 'thumbs_up' || content === 'hooray' || content === 'rocket' ? 'no_findings' : null;
    if (signal) add(reaction.login, { kind: 'reaction', time: toTime(reaction.createdAt), signal });
  }

  const pending = [];
  const findings = [];
  const timedOut = [];
  for (const { login, events } of bots.values()) {
    const current = events.filter(event => event.forHead || anchor === null || (event.time !== null && event.time >= anchor)).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    for (const event of current) {
      if (event.kind === 'comment' && event.signal === 'findings') {
        findings.push({ id: `${event.comment.id}@${event.comment.updatedAt || event.comment.createdAt || ''}`, login, url: event.comment.url, excerpt: excerptOf(event.comment.body) });
      }
    }
    if (anchor === null) continue;
    const latest = current[current.length - 1];
    if (!latest) {
      const deadline = anchor + startGraceMinutes * 60_000;
      if (deadline > now) pending.push({ login, reason: 'reviewed earlier commits; waiting for it to start on the head commit', deadline });
      continue;
    }
    if (latest.signal === 'in_progress') {
      const deadline = anchor + waitMinutes * 60_000;
      if (deadline > now) pending.push({ login, reason: latest.kind === 'reaction' ? 'reviewing the head commit (👀)' : 'reviewing the head commit', deadline });
      else timedOut.push(login);
    }
  }
  const remainingMs = pending.length > 0 ? Math.max(0, Math.max(...pending.map(item => item.deadline)) - now) : 0;
  return { anchor, pending, remainingMs, findings, timedOut };
};

/** Remembers which review-app findings an AI session already received (like the thread tracker). */
export const createReviewBotFindingsTracker = () => {
  const reported = new Set();
  return {
    split(findings) {
      const fresh = [];
      const alreadyReported = [];
      for (const finding of findings || []) (reported.has(finding.id) ? alreadyReported : fresh).push(finding);
      return { fresh, alreadyReported };
    },
    markReported(findings) {
      for (const finding of findings || []) if (finding?.id) reported.add(finding.id);
    },
  };
};

/** Prompt lines for findings a review app reported in its summary. */
export const buildReviewBotFindingLines = findings => {
  if (!findings || findings.length === 0) return [];
  const lines = [promptText('prompt.templates.review-bots.feedback.header', { count: String(findings.length) })];
  for (const finding of findings) lines.push(promptText('prompt.templates.review-bots.feedback.item', { login: finding.login, excerpt: finding.excerpt || 'no text', url: finding.url || 'no URL' }));
  lines.push(promptText('prompt.templates.review-bots.feedback.instruction'));
  return lines;
};

/** Markdown list items naming the review-app summaries that still report findings. */
export const formatReviewBotFindingsForComment = findings => (findings || []).map(finding => `- ${finding.url ? `[${finding.login}](${finding.url})` : finding.login}: ${finding.excerpt || 'reports unresolved findings'}`);

export default {
  DEFAULT_REVIEW_BOTS,
  DEFAULT_REVIEW_BOTS_WAIT_MINUTES,
  REVIEW_BOTS_START_GRACE_MINUTES,
  REVIEW_BOT_ACTIVITY_QUERY,
  normalizeBotLogin,
  parseReviewBotsOption,
  createReviewBotMatcher,
  parseCodexReviewState,
  reviewBotSignal,
  isReviewBotFeedback,
  fetchReviewBotActivity,
  evaluateReviewBotActivity,
  createReviewBotFindingsTracker,
  buildReviewBotFindingLines,
  formatReviewBotFindingsForComment,
};
