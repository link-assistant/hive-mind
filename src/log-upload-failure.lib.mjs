#!/usr/bin/env node

/**
 * Issue #2301: what the pull request says when the log could not be published.
 *
 * In link-foundation/meta-language#196 the AI session failed, the 165 MB log hit
 * "RPC failed; HTTP 408" on its only upload attempt, and `attachLogToGitHub`
 * returned false without posting anything. The pull request was left with the
 * automation-stop comment alone, which told the reader to "Review the attached
 * working session log", but no log had been attached.
 *
 * Posting a truncated log instead is not allowed (issue #1678: reviewers mistake
 * partial content for the complete trace). So the comment carries no log
 * content. It states the outcome, the session error if there was one, why every
 * upload attempt failed, and where the complete log is kept.
 *
 * It also serves multi-part uploads: {@link formatLogLinkLines} lists every part.
 */

import { writeSanitizedPublicationFile } from './token-sanitization.lib.mjs';
import { LOG_UPLOAD_FAILED_MARKER, NOW_WORKING_SESSION_IS_ENDED_MARKER, SOLUTION_DRAFT_FAILED_MARKER, SOLUTION_DRAFT_LOG_MARKER, postTrackedCommentFromFile } from './tool-comments.lib.mjs';

const formatSize = bytes => (bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`);

/**
 * Markdown link lines for an uploaded log: one line, or one line per part when
 * the log was published as several parts.
 * @param {Object} params
 * @param {Object} params.uploadResult - Result of uploadLogWithGhUploadLog.
 * @param {string} params.logUrl - URL chosen for a single upload.
 * @param {string} params.label - Link text, e.g. "View complete failure log".
 * @param {Function} params.selectUrl - Picks the URL for one part (selectLogUploadUrl).
 * @returns {string}
 */
export const formatLogLinkLines = ({ uploadResult, logUrl, label, selectUrl }) => {
  const parts = Array.isArray(uploadResult?.parts) ? uploadResult.parts : [];
  if (parts.length < 2) return `- [${label}](${logUrl})`;
  return parts.map((part, index) => `- [${label}: part ${index + 1} of ${parts.length}](${selectUrl(part) || part.url})`).join('\n');
};

/**
 * Build the comment posted when the complete log could not be uploaded.
 * @param {Object} params
 * @param {string|null} [params.errorMessage] - Why the session itself failed, if it did.
 * @param {string|null} [params.failureReason] - Why the upload failed (summarized gh-upload-log output).
 * @param {number|null} [params.attempts] - How many upload attempts were made.
 * @param {number} params.logSizeBytes
 * @param {string} params.logFile - Where the complete log is kept.
 * @param {boolean} [params.isPublic=true] - Visibility the upload would have had.
 * @param {string} [params.failureAction=''] - Extra section for failures (e.g. "what to do next").
 * @returns {string}
 */
export const buildLogUploadFailureComment = ({ errorMessage = null, failureReason = null, attempts = null, logSizeBytes, logFile, isPublic = true, failureAction = '' }) => {
  const heading = errorMessage ? `## 🚨 ${SOLUTION_DRAFT_FAILED_MARKER}\nThe automated solution draft encountered an error:\n\`\`\`\n${errorMessage}\n\`\`\`${failureAction || ''}\n\n### ⚠️ ${LOG_UPLOAD_FAILED_MARKER}` : `## ⚠️ ${SOLUTION_DRAFT_LOG_MARKER}: ${LOG_UPLOAD_FAILED_MARKER}`;
  const attemptText = attempts > 1 ? ` after ${attempts} attempts` : '';
  const reason = failureReason ? `\n\nLast upload error:\n\`\`\`\n${failureReason}\n\`\`\`` : '';
  return `${heading}
The complete ${errorMessage ? 'failure' : 'working session'} log (${formatSize(logSizeBytes)}) could not be uploaded${attemptText}, so it is not attached here. A partial log is not posted instead, because it could be mistaken for the complete trace.${reason}

The complete log is kept on the machine that ran this session:
\`\`\`
${logFile}
\`\`\`
To publish it from there:
\`\`\`bash
gh-upload-log "${logFile}" ${isPublic ? '--public' : '--private'}
\`\`\`

---
*${NOW_WORKING_SESSION_IS_ENDED_MARKER}, feel free to review and add any feedback on the solution draft.*`;
};

/**
 * Post {@link buildLogUploadFailureComment}. Never throws: a failed post is
 * logged and reported as `false`.
 * @returns {Promise<boolean>} Whether the comment was posted.
 */
export const postLogUploadFailureComment = async ({ $, owner, repo, targetNumber, targetType = 'pr', log, postComment = postTrackedCommentFromFile, ...commentParams }) => {
  const bodyFile = `/tmp/log-upload-failed-comment-${targetType}-${Date.now()}.md`;
  try {
    await writeSanitizedPublicationFile(bodyFile, buildLogUploadFailureComment(commentParams));
    const posted = await postComment({ $, owner, repo, targetNumber, bodyFile });
    if (posted?.ok) {
      await log(`  📝 Posted a "${LOG_UPLOAD_FAILED_MARKER}" comment explaining why the log is not attached${posted.commentId ? ` (comment id=${posted.commentId})` : ''}`);
      return true;
    }
    await log(`  ❌ Could not post the "${LOG_UPLOAD_FAILED_MARKER}" comment: ${posted?.stderr?.toString() || 'unknown error'}`);
    return false;
  } catch (error) {
    await log(`  ❌ Could not post the "${LOG_UPLOAD_FAILED_MARKER}" comment: ${error.message}`);
    return false;
  } finally {
    const fs = await import('node:fs/promises');
    await fs.unlink(bodyFile).catch(() => {});
  }
};
