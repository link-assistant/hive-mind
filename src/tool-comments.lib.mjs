#!/usr/bin/env node

/**
 * Centralized definitions for GitHub comments posted by solve.mjs itself
 * (session bookkeeping, log uploads, auto-restart notices, etc.) — as
 * opposed to comments posted by the AI agent via its own tool calls.
 *
 * Issue #1625: --auto-attach-solution-summary was broken because the tool's
 * own "AI Work Session Started" / "Solution Draft Log" / "Ready to merge"
 * comments counted as AI-authored comments, so the summary was always
 * suppressed even when the AI session produced zero comments of its own.
 *
 * This module is the single source of truth for the marker strings embedded
 * in those comments. Posting sites use these constants to *build* comment
 * bodies; the summary filter uses the same constants to *detect* them. If a
 * marker needs to change, changing it here updates both sides — no more
 * duplicate literals drifting apart.
 *
 * It also provides in-memory tracking: any comment posted by solve.mjs can
 * be registered by its numeric GitHub comment ID, and checkForAiCreatedComments
 * uses that set as the *primary* filter (marker matching is the fallback for
 * comments whose IDs were not captured, e.g. when `gh pr comment` didn't
 * return JSON).
 */

// ----------------------------------------------------------------------------
// Marker constants — single source of truth for comment header/keyphrase text.
// Each constant is the exact substring that both (a) appears in the posted
// comment body and (b) is searched for when filtering out tool-generated
// comments. Do NOT duplicate these literals elsewhere.
// ----------------------------------------------------------------------------

// solve.session.lib.mjs — startWorkSession() / endWorkSession()
export const AI_WORK_SESSION_STARTED_MARKER = 'AI Work Session Started';
export const AI_WORK_SESSION_COMPLETED_MARKER = 'AI Work Session Completed';
export const AI_WORK_SESSION_RESUMED_MARKER = 'AI Work Session Resumed';

// solve.session.lib.mjs — auto-resume / auto-restart on limit reset
export const AUTO_RESUME_ON_LIMIT_RESET_MARKER = 'Auto Resume (on limit reset)';
export const AUTO_RESTART_ON_LIMIT_RESET_MARKER = 'Auto Restart (on limit reset)';

// github.lib.mjs — attachLogToGitHub() success / resumed / truncated log comments
export const SOLUTION_DRAFT_LOG_MARKER = 'Solution Draft Log';

// solve.watch.lib.mjs / solve.auto-merge.lib.mjs — auto-restart notifications
export const AUTO_RESTART_MARKER = 'Auto-restart';
export const AUTO_RESTART_UNTIL_MERGEABLE_LOG_MARKER = 'Auto-restart-until-mergeable Log';

// solve.auto-merge.lib.mjs — "ready to merge" status comments
export const READY_TO_MERGE_MARKER = 'Ready to merge';

// solve.auto-merge.lib.mjs — external review quota/credit stop comments
export const READY_FOR_REVIEW_MARKER = 'Ready for review';

// solve.auto-merge.lib.mjs — "auto-merged successfully" status comments
export const AUTO_MERGED_MARKER = 'Auto-merged';

// solve.auto-merge.lib.mjs — billing-limit notification (spending cap / free tier)
export const BILLING_LIMIT_MARKER = 'GitHub Actions Billing Limit';

// solve.auto-merge.lib.mjs — cancelled/stale CI needs manual review
export const CANCELLED_CI_REVIEW_MARKER = 'Cancelled CI/CD Requires Review';

// solve.results.lib.mjs — working session summary comments posted by
// --attach-solution-summary / --auto-attach-solution-summary at the end of
// every working session (top-level solve, auto-restart-until-mergeable
// iteration, or watch-mode iteration). Issue #1728: Renamed from
// "Solution summary" because not every working session is a solution draft —
// many are continuation/restart iterations that are part of an in-progress
// solution. Automation evidence is tracked separately so the visible heading
// can still be used by real AI-authored comments.
export const WORKING_SESSION_SUMMARY_MARKER = 'Working session summary';
// Issue #1813: the visible "Working session summary" heading is natural text
// that Codex can write in its own PR comment. Do not treat the heading alone as
// a tool-generated marker. New automated summaries include this hidden marker;
// legacy automated summaries are still recognized by the footer text below.
export const WORKING_SESSION_SUMMARY_AUTOMATION_MARKER = '<!-- hive-mind:working-session-summary -->';
export const WORKING_SESSION_SUMMARY_AUTOMATED_FOOTER = 'This summary was automatically extracted from the AI working session output.';

// github.lib.mjs — fork contributor "Allow edits by maintainers" request
export const MAINTAINER_ACCESS_REQUEST_MARKER = 'Allow edits by maintainers';

// solve.progress-monitoring.lib.mjs — live-progress comment section markers.
// These are HTML comments so they don't render in the GitHub UI; they exist
// specifically to let the tool find its own comment later.
export const LIVE_PROGRESS_SECTION_START_MARKER = '<!-- LIVE-PROGRESS-START -->';
export const LIVE_PROGRESS_SECTION_END_MARKER = '<!-- LIVE-PROGRESS-END -->';

// claude.lib.mjs — "session force-killed due to stream timeout" notifications
export const SESSION_FORCE_KILLED_MARKER = 'Session Force-Killed';

// solve.repo-setup.lib.mjs / solve.repository.lib.mjs — issue comments posted
// when the target repository is empty / uninitialized so solving can't start.
export const REPOSITORY_INITIALIZATION_REQUIRED_MARKER = 'Repository Initialization Required';

// interactive-mode.lib.mjs — interactive mode session comments
export const INTERACTIVE_SESSION_STARTED_MARKER = 'Interactive session started';
export const INTERACTIVE_SESSION_ENDED_MARKER = 'Interactive session ended';

// github.lib.mjs — closing footer present in every log upload comment variant
export const NOW_WORKING_SESSION_IS_ENDED_MARKER = 'Now working session is ended';

// Failure-path markers (github.lib.mjs error paths)
export const SOLUTION_DRAFT_FAILED_MARKER = 'Solution Draft Failed';
export const SOLUTION_DRAFT_FINISHED_WITH_ERRORS_MARKER = 'Solution Draft Finished with Errors';
export const USAGE_LIMIT_REACHED_MARKER = 'Usage Limit Reached';

/**
 * Every marker that identifies a tool-posted comment. Derived from the
 * named constants above so that adding a new marker only requires adding
 * the constant and appending it here.
 */
export const TOOL_GENERATED_COMMENT_MARKERS = [AI_WORK_SESSION_STARTED_MARKER, AI_WORK_SESSION_COMPLETED_MARKER, AI_WORK_SESSION_RESUMED_MARKER, AUTO_RESUME_ON_LIMIT_RESET_MARKER, AUTO_RESTART_ON_LIMIT_RESET_MARKER, SOLUTION_DRAFT_LOG_MARKER, AUTO_RESTART_MARKER, AUTO_RESTART_UNTIL_MERGEABLE_LOG_MARKER, READY_TO_MERGE_MARKER, READY_FOR_REVIEW_MARKER, AUTO_MERGED_MARKER, BILLING_LIMIT_MARKER, CANCELLED_CI_REVIEW_MARKER, MAINTAINER_ACCESS_REQUEST_MARKER, LIVE_PROGRESS_SECTION_START_MARKER, SESSION_FORCE_KILLED_MARKER, REPOSITORY_INITIALIZATION_REQUIRED_MARKER, INTERACTIVE_SESSION_STARTED_MARKER, INTERACTIVE_SESSION_ENDED_MARKER, NOW_WORKING_SESSION_IS_ENDED_MARKER, SOLUTION_DRAFT_FAILED_MARKER, SOLUTION_DRAFT_FINISHED_WITH_ERRORS_MARKER, USAGE_LIMIT_REACHED_MARKER, WORKING_SESSION_SUMMARY_AUTOMATION_MARKER];

/**
 * Markers that indicate the end of a working session. Used by
 * solve.auto-merge-helpers.checkForExistingComment to scope the
 * duplicate-search window to the current session only (Issue #1584).
 */
export const SESSION_ENDING_MARKERS = [NOW_WORKING_SESSION_IS_ENDED_MARKER, AI_WORK_SESSION_COMPLETED_MARKER];

/**
 * Determine whether a GitHub comment body matches any known tool-generated
 * marker. Used as a fallback when a comment's ID was not captured by
 * in-memory tracking (see below).
 *
 * @param {string} body - The comment body
 * @returns {boolean} - True if the body contains a tool-generated marker
 */
export const isAutomatedWorkingSessionSummaryComment = body => {
  if (!body || typeof body !== 'string') return false;
  return body.includes(WORKING_SESSION_SUMMARY_AUTOMATION_MARKER) || (body.includes(`## ${WORKING_SESSION_SUMMARY_MARKER}`) && body.includes(WORKING_SESSION_SUMMARY_AUTOMATED_FOOTER));
};

export const isToolGeneratedComment = body => {
  if (!body || typeof body !== 'string') return false;
  return isAutomatedWorkingSessionSummaryComment(body) || TOOL_GENERATED_COMMENT_MARKERS.some(marker => body.includes(marker));
};

// ----------------------------------------------------------------------------
// In-memory tracking of comments posted by solve.mjs during this session.
//
// Every tool-initiated comment-post helper should register its comment ID
// via trackToolCommentId(). checkForAiCreatedComments() then uses the set
// as the primary filter, falling back to marker-based detection for any
// comment whose ID was not captured.
//
// IDs are GitHub numeric comment IDs (from issue/PR/review comment APIs),
// coerced to strings for consistent Set membership. Review (inline) comments
// and conversation comments share the same ID namespace at the API layer,
// but we never mix them since solve.mjs only posts to conversation + issue
// endpoints — review comments are AI-only.
// ----------------------------------------------------------------------------

const trackedToolCommentIds = new Set();

/**
 * Register a comment ID as tool-generated. Safe to call with null/undefined
 * (e.g., when comment posting failed or the ID couldn't be extracted).
 * @param {string|number|null|undefined} commentId
 */
export const trackToolCommentId = commentId => {
  if (commentId === null || commentId === undefined) return;
  trackedToolCommentIds.add(String(commentId));
};

/**
 * Returns whether a given comment ID was posted by solve.mjs itself during
 * this session.
 * @param {string|number|null|undefined} commentId
 * @returns {boolean}
 */
export const isToolTrackedCommentId = commentId => {
  if (commentId === null || commentId === undefined) return false;
  return trackedToolCommentIds.has(String(commentId));
};

/**
 * Returns the set of tracked comment IDs (read-only snapshot).
 * Primarily for tests and diagnostics.
 * @returns {Set<string>}
 */
export const getTrackedToolCommentIds = () => new Set(trackedToolCommentIds);

/**
 * Reset tracking state. Primarily for tests; solve.mjs does not need to
 * call this between real sessions because each invocation is a fresh
 * process.
 */
export const resetTrackedToolCommentIds = () => {
  trackedToolCommentIds.clear();
};

/**
 * Post a GitHub comment on a PR or issue via `gh api` and return the
 * numeric comment ID (as string). The ID is also automatically tracked in
 * the in-memory set above.
 *
 * This is the preferred path for all tool-posted comments because `gh pr
 * comment` / `gh issue comment` only print the comment URL to stdout, and
 * extracting the numeric ID from a URL is brittle. `gh api POST` returns
 * full JSON, from which the ID is trivial to extract.
 *
 * Falls back to best-effort URL parsing if JSON parsing fails, so a single
 * API change cannot break the code path.
 *
 * @param {Object} options
 * @param {Function} options.$ - command-stream tagged template (required — we
 *   accept it as a parameter so this module has no top-level dependency on
 *   `command-stream`, keeping it cheap to import from tests)
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {number|string} options.targetNumber - PR or issue number
 * @param {string} options.body
 * @returns {Promise<{ok: boolean, commentId: string|null, stderr?: string}>}
 */
export const postTrackedComment = async ({ $, owner, repo, targetNumber, body, sanitizationOptions }) => {
  if (!$) {
    throw new Error('postTrackedComment requires a command-stream $ helper');
  }

  // Use `gh api` with stdin to avoid shell-quoting problems on multi-line
  // bodies and to get JSON back so we can extract the comment ID.
  // We use the /issues/<n>/comments endpoint because it works identically
  // for both PRs and issues (a PR is an issue at this endpoint).
  const apiPath = `repos/${owner}/${repo}/issues/${targetNumber}/comments`;
  const { sanitizeOutput } = await import('./token-sanitization.lib.mjs');
  // Issue #1745: caller may pass dangerous-skip flags + carve-out tokens.
  // Defaults preserve fail-closed behavior: full sanitization.
  const sanitizedBody = await sanitizeOutput(body, sanitizationOptions || {});
  const payload = JSON.stringify({ body: sanitizedBody });

  // command-stream's options key is `stdin`, not `input` — unknown keys are
  // silently ignored, which previously left stdin inherited from the parent
  // and caused `gh api --input -` to POST an empty body. GitHub's edge
  // replied with HTTP 400 "Whoa there!" *before* the API layer ran. See
  // issue #1631.
  let result;
  try {
    result = await $({ stdin: payload })`gh api ${apiPath} -X POST --input -`;
  } catch (err) {
    return { ok: false, commentId: null, stderr: err && err.message ? err.message : String(err) };
  }

  if (result.code !== 0) {
    const stderr = result.stderr ? result.stderr.toString() : '';
    return { ok: false, commentId: null, stderr };
  }

  const stdout = result.stdout ? result.stdout.toString() : '';
  let commentId = null;
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && parsed.id !== undefined && parsed.id !== null) {
      commentId = String(parsed.id);
    }
  } catch {
    // Fallback: match numeric id in the JSON text, or the issuecomment-<n>
    // fragment in the html_url, whichever shows up first.
    const match = stdout.match(/"id"\s*:\s*(\d+)|issuecomment-(\d+)/);
    if (match) commentId = match[1] || match[2] || null;
  }

  trackToolCommentId(commentId);

  return { ok: true, commentId };
};

/**
 * Post a GitHub comment whose body is already written to a file on disk.
 * Used by attachLogToGitHub() where the comment body can be tens of KB
 * (entire execution log embedded in a <details>) — too large for inline
 * shell arguments and awkward to pipe as stdin JSON.
 *
 * Reads the file and posts via postTrackedComment() so the returned comment
 * ID is tracked exactly like any other tool-posted comment. Kept separate
 * from postTrackedComment so callers that already have a body string don't
 * pay for a tempfile round-trip.
 *
 * @param {Object} options
 * @param {Function} options.$ - command-stream tagged template
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {number|string} options.targetNumber
 * @param {string} options.bodyFile - absolute path to the comment body file
 * @returns {Promise<{ok: boolean, commentId: string|null, stderr?: string}>}
 */
export const postTrackedCommentFromFile = async ({ $, owner, repo, targetNumber, bodyFile }) => {
  if (!$) {
    throw new Error('postTrackedCommentFromFile requires a command-stream $ helper');
  }
  if (typeof globalThis.use === 'undefined') {
    globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
  }
  const fs = (await globalThis.use('fs')).promises;
  let body;
  try {
    body = await fs.readFile(bodyFile, 'utf8');
  } catch (err) {
    return { ok: false, commentId: null, stderr: err && err.message ? err.message : String(err) };
  }
  return postTrackedComment({ $, owner, repo, targetNumber, body });
};
