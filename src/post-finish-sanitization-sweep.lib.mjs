#!/usr/bin/env node
/**
 * Issue #1745 — post-finish sanitization sweep.
 *
 * Comment #4364642786 requirement: "after AI finishes whatever the content
 * was ... we should by default go and mask the token by editing comments,
 * pull requests".
 *
 * This module re-reads bot-authored comments and the PR description after the
 * AI session finishes, runs the body through `sanitizeOutput`, and edits the
 * comment / PR in place if a difference is detected. It is intentionally
 * conservative:
 *
 *   - We only touch content authored by the running gh user (the bot).
 *   - We never touch issue bodies (those belong to the human).
 *   - History rewriting (force-pushing to delete commits) is NOT performed
 *     here. The risk to a shared branch is too high; that step requires the
 *     operator to opt in explicitly via a future flag, and is documented in
 *     docs/case-studies/issue-1745/analysis.md.
 *
 * @module post-finish-sanitization-sweep
 */

import { sanitizeOutput, getSanitizationStats } from './token-sanitization.lib.mjs';
import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs'; // rate-limit marker (#1726): caller passes $ already wrapped through wrapDollarWithGhRetry

/**
 * Determine the bot's gh login name. The function returns null on any error
 * so the sweep degrades gracefully when offline / unauthenticated.
 *
 * @param {Function} $
 * @returns {Promise<string|null>}
 */
const detectBotLogin = async $ => {
  try {
    const result = await $`gh api user --jq .login`;
    if (result && result.code === 0 && result.stdout) {
      const login = result.stdout.toString().trim();
      return login || null;
    }
  } catch {
    /* swallow */
  }
  return null;
};

/**
 * Sanitize bot-authored PR conversation comments (the issuecomment endpoint).
 *
 * @param {Object} args
 * @param {Function} args.$ command-stream helper
 * @param {string}   args.owner
 * @param {string}   args.repo
 * @param {number|string} args.prNumber
 * @param {string}   args.botLogin
 * @param {Function} [args.log]
 * @param {Object}   [args.sanitizationOptions] forwarded to sanitizeOutput
 * @returns {Promise<{scanned:number, edited:number, errors:number}>}
 */
export const sweepPrConversationComments = async ({ $, owner, repo, prNumber, botLogin, log = async () => {}, sanitizationOptions = {} }) => {
  const stats = { scanned: 0, edited: 0, errors: 0 };
  let response;
  try {
    response = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`;
  } catch (err) {
    await log(`⚠️ post-finish sweep: failed to list comments: ${err.message || err}`);
    stats.errors++;
    return stats;
  }
  if (!response || response.code !== 0) {
    stats.errors++;
    return stats;
  }
  let comments;
  try {
    comments = JSON.parse(response.stdout.toString());
  } catch {
    stats.errors++;
    return stats;
  }
  if (!Array.isArray(comments)) return stats;

  for (const c of comments) {
    if (!c || !c.user || c.user.login !== botLogin) continue;
    if (typeof c.body !== 'string' || c.body.length === 0) continue;
    stats.scanned++;
    let sanitized;
    try {
      sanitized = await sanitizeOutput(c.body, sanitizationOptions);
    } catch (err) {
      await log(`⚠️ post-finish sweep: sanitize comment ${c.id} failed: ${err.message || err}`);
      stats.errors++;
      continue;
    }
    if (sanitized === c.body) continue;
    try {
      const payload = JSON.stringify({ body: sanitized });
      const edit = await $({ stdin: payload })`gh api repos/${owner}/${repo}/issues/comments/${c.id} -X PATCH --input -`;
      if (edit && edit.code === 0) {
        stats.edited++;
        await log(`🔒 post-finish sweep: edited comment ${c.id} to mask leaked token(s)`);
      } else {
        stats.errors++;
      }
    } catch (err) {
      await log(`⚠️ post-finish sweep: edit comment ${c.id} failed: ${err.message || err}`);
      stats.errors++;
    }
  }
  return stats;
};

/**
 * Sanitize the PR description if needed.
 *
 * @param {Object} args
 * @returns {Promise<{scanned:number, edited:number, errors:number}>}
 */
export const sweepPrDescription = async ({ $, owner, repo, prNumber, log = async () => {}, sanitizationOptions = {} }) => {
  const stats = { scanned: 0, edited: 0, errors: 0 };
  let response;
  try {
    response = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
  } catch (err) {
    await log(`⚠️ post-finish sweep: failed to fetch PR ${prNumber}: ${err.message || err}`);
    stats.errors++;
    return stats;
  }
  if (!response || response.code !== 0) {
    stats.errors++;
    return stats;
  }
  let pr;
  try {
    pr = JSON.parse(response.stdout.toString());
  } catch {
    stats.errors++;
    return stats;
  }
  const body = typeof pr.body === 'string' ? pr.body : '';
  if (body.length === 0) return stats;
  stats.scanned++;
  let sanitized;
  try {
    sanitized = await sanitizeOutput(body, sanitizationOptions);
  } catch (err) {
    await log(`⚠️ post-finish sweep: sanitize PR body failed: ${err.message || err}`);
    stats.errors++;
    return stats;
  }
  if (sanitized === body) return stats;
  try {
    const payload = JSON.stringify({ body: sanitized });
    const edit = await $({ stdin: payload })`gh api repos/${owner}/${repo}/pulls/${prNumber} -X PATCH --input -`;
    if (edit && edit.code === 0) {
      stats.edited++;
      await log('🔒 post-finish sweep: edited PR description to mask leaked token(s)');
    } else {
      stats.errors++;
    }
  } catch (err) {
    await log(`⚠️ post-finish sweep: edit PR body failed: ${err.message || err}`);
    stats.errors++;
  }
  return stats;
};

/**
 * Run the full post-finish sweep: bot-authored PR comments + PR description.
 * Idempotent and safe to call multiple times.
 *
 * @param {Object} args
 * @returns {Promise<{comments:Object, prBody:Object, totalEdited:number, sanitizationStatsBefore:Object, sanitizationStatsAfter:Object}>}
 */
export const runPostFinishSweep = async ({ $, owner, repo, prNumber, log = async () => {}, sanitizationOptions = {}, botLogin: providedBotLogin }) => {
  const sanitizationStatsBefore = getSanitizationStats();
  const botLogin = providedBotLogin || (await detectBotLogin($));
  const result = {
    comments: { scanned: 0, edited: 0, errors: 0, skipped: !botLogin },
    prBody: { scanned: 0, edited: 0, errors: 0 },
    totalEdited: 0,
    sanitizationStatsBefore,
    sanitizationStatsAfter: sanitizationStatsBefore,
  };
  if (!owner || !repo || !prNumber) return result;
  if (botLogin) {
    result.comments = await sweepPrConversationComments({ $, owner, repo, prNumber, botLogin, log, sanitizationOptions });
  } else {
    await log('⚠️ post-finish sweep: could not determine bot login; skipping comment sweep.');
  }
  result.prBody = await sweepPrDescription({ $, owner, repo, prNumber, log, sanitizationOptions });
  result.totalEdited = result.comments.edited + result.prBody.edited;
  result.sanitizationStatsAfter = getSanitizationStats();
  return result;
};

export default {
  sweepPrConversationComments,
  sweepPrDescription,
  runPostFinishSweep,
};
