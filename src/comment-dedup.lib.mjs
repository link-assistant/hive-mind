/**
 * Comment deduplication utilities for preventing duplicate PR/issue comments.
 *
 * Issue #1495: Multiple repeated comments were posted after `ready to merge`
 * because neither the AI agent nor the system checked for existing similar
 * comments before posting new ones.
 *
 * This module provides:
 * - checkForRecentSimilarComment(): checks recent PR comments for similar content
 * - normalizeCommentForComparison(): strips formatting to compare semantic content
 * - computeSimilarity(): computes a normalized similarity score between two texts
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1495
 */

// Check if use is already defined globally (when imported from solve.mjs)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const { $ } = await use('command-stream');

const lib = await import('./lib.mjs');
const { log } = lib;

/**
 * Normalize a comment body for comparison purposes.
 * Strips markdown formatting, whitespace, timestamps, and other variable elements
 * to focus on the semantic content.
 *
 * @param {string} text - The comment body to normalize
 * @returns {string} - Normalized text suitable for comparison
 */
export const normalizeCommentForComparison = text => {
  if (!text) return '';

  return (
    text
      // Remove markdown headers (## ✅, ## 🤖, etc.)
      .replace(/^#{1,6}\s*/gm, '')
      // Remove emoji
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '')
      // Remove timestamps (ISO 8601 format)
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '')
      // Remove markdown bold/italic
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      // Remove markdown links but keep link text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove markdown table formatting
      .replace(/\|/g, ' ')
      .replace(/-{3,}/g, '')
      // Remove horizontal rules and signature lines
      .replace(/^---$/gm, '')
      // Remove lines containing hive-mind or Monitored by (case-insensitive, any surrounding chars)
      .replace(/^.*hive-mind.*$/gim, '')
      .replace(/^.*monitored by.*$/gim, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
};

/**
 * Extract the first meaningful line from a comment (the "header").
 * This is typically the markdown header or first non-empty line.
 *
 * @param {string} text - Raw comment text
 * @returns {string} - Normalized header string
 */
export const extractCommentHeader = text => {
  if (!text) return '';
  // Find first non-empty line, strip markdown header chars and emoji
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  if (lines.length === 0) return '';
  return normalizeCommentForComparison(lines[0]);
};

/**
 * Compute a normalized similarity score between two comments.
 * Combines two signals:
 * 1. Header similarity: if both comments share the same header/title (e.g., "Validation Complete"),
 *    this is a strong signal of duplicate intent.
 * 2. Word overlap coefficient: fraction of the smaller set's keywords in the larger set.
 *
 * The final score is weighted: header match boosts similarity significantly.
 *
 * @param {string} a - First text (already normalized)
 * @param {string} b - Second text (already normalized)
 * @returns {number} - Similarity score between 0 (no overlap) and 1 (complete overlap)
 */
export const computeSimilarity = (a, b) => {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  // Use the smaller set for overlap coefficient
  const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];

  let intersection = 0;
  for (const word of smaller) {
    if (larger.has(word)) intersection++;
  }

  return intersection / smaller.size;
};

/**
 * Compute similarity between two raw comment bodies, combining
 * header matching with content overlap for better duplicate detection.
 *
 * @param {string} rawA - First raw comment body
 * @param {string} rawB - Second raw comment body
 * @returns {number} - Combined similarity score between 0 and 1
 */
export const computeCommentSimilarity = (rawA, rawB) => {
  const normA = normalizeCommentForComparison(rawA);
  const normB = normalizeCommentForComparison(rawB);

  // Base word overlap
  const wordOverlap = computeSimilarity(normA, normB);

  // Header similarity bonus
  const headerA = extractCommentHeader(rawA);
  const headerB = extractCommentHeader(rawB);
  const headerMatch = headerA && headerB && computeSimilarity(headerA, headerB) >= 0.8;

  // If headers match strongly, boost the overall similarity
  // This catches cases like "Validation Complete" vs "Validation Complete — All Checks Passed"
  if (headerMatch) {
    return Math.min(1, wordOverlap + 0.3);
  }

  return wordOverlap;
};

/**
 * Check if a similar comment already exists on the PR within a given time window.
 *
 * This is the main deduplication function. Before posting a comment, call this
 * to check if a sufficiently similar comment was recently posted.
 *
 * @param {Object} options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {string} options.commentBody - The comment body about to be posted
 * @param {number} [options.timeWindowMinutes=5] - Time window in minutes to check for recent comments
 * @param {number} [options.similarityThreshold=0.7] - Jaccard similarity threshold (0-1) above which comments are considered duplicates
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Promise<{isDuplicate: boolean, matchedComment: Object|null}>}
 */
export const checkForRecentSimilarComment = async ({ owner, repo, prNumber, commentBody, timeWindowMinutes = 5, similarityThreshold = 0.7, verbose = false }) => {
  try {
    const result = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=10&sort=created&direction=desc 2>/dev/null`;

    if (result.code !== 0 || !result.stdout) {
      if (verbose) {
        await log('[comment-dedup] Could not fetch recent comments, allowing post', { verbose: true });
      }
      return { isDuplicate: false, matchedComment: null };
    }

    const comments = JSON.parse(result.stdout.toString().trim() || '[]');
    if (comments.length === 0) {
      return { isDuplicate: false, matchedComment: null };
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - timeWindowMinutes * 60 * 1000);
    for (const comment of comments) {
      const commentTime = new Date(comment.created_at);

      // Only check comments within the time window
      if (commentTime < cutoff) {
        continue;
      }

      const similarity = computeCommentSimilarity(commentBody, comment.body);

      if (similarity >= similarityThreshold) {
        if (verbose) {
          await log(`[comment-dedup] Found similar comment (similarity: ${(similarity * 100).toFixed(1)}%) posted at ${comment.created_at}`, { verbose: true });
          await log(`[comment-dedup] Existing comment URL: ${comment.html_url}`, { verbose: true });
        }
        return { isDuplicate: true, matchedComment: comment };
      }
    }

    return { isDuplicate: false, matchedComment: null };
  } catch (error) {
    // On error, allow posting to avoid silent failures
    if (verbose) {
      await log(`[comment-dedup] Error checking for duplicates: ${error.message}`, { verbose: true });
    }
    return { isDuplicate: false, matchedComment: null };
  }
};

/**
 * Post a comment to a PR with built-in deduplication.
 * Wraps the standard `gh pr comment` with a pre-check for similar recent comments.
 *
 * @param {Object} options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {string} options.body - Comment body to post
 * @param {number} [options.timeWindowMinutes=5] - Dedup time window in minutes
 * @param {number} [options.similarityThreshold=0.7] - Similarity threshold for dedup
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {boolean} [options.skipDedup=false] - Skip deduplication check (for session markers that should always post)
 * @returns {Promise<{posted: boolean, reason: string, commentUrl: string|null}>}
 */
export const postCommentWithDedup = async ({ owner, repo, prNumber, body, timeWindowMinutes = 5, similarityThreshold = 0.7, verbose = false, skipDedup = false }) => {
  // Check for duplicates unless explicitly skipped
  if (!skipDedup) {
    const { isDuplicate, matchedComment } = await checkForRecentSimilarComment({
      owner,
      repo,
      prNumber,
      commentBody: body,
      timeWindowMinutes,
      similarityThreshold,
      verbose,
    });

    if (isDuplicate) {
      await log(`[comment-dedup] Skipping duplicate comment (similar to ${matchedComment?.html_url || 'existing comment'})`);
      return { posted: false, reason: 'duplicate', commentUrl: matchedComment?.html_url || null };
    }
  }

  // Post the comment
  try {
    const result = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${body}`;
    if (result.code === 0) {
      const commentUrl = result.stdout?.toString().trim() || null;
      return { posted: true, reason: 'success', commentUrl };
    } else {
      return { posted: false, reason: 'gh_error', commentUrl: null };
    }
  } catch (error) {
    await log(`[comment-dedup] Error posting comment: ${error.message}`, { level: 'warning' });
    return { posted: false, reason: 'error', commentUrl: null };
  }
};
