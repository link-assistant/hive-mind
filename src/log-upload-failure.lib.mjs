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

import { detectExecutionContext } from './solve.resource-diagnostics.lib.mjs';
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
 * Issue #2400: where the log file actually lives.
 *
 * On link-assistant/hive-mind#2398 the comment said the log "is kept on the
 * machine that ran this session" and named `/home/box/<uuid>.log`, but that path
 * was inside a Docker-isolated task container, which start-command removed six
 * seconds later because the session exited 0. `ls` on the host found nothing.
 * The isolation runner exports `HIVE_MIND_PARENT_SESSION_ID` to every
 * Docker-isolated task (isolation-runner.lib.mjs), so it identifies that case.
 *
 * @param {Object} [options]
 * @param {Object} [options.env=process.env]
 * @param {Function} [options.detectContext=detectExecutionContext] - injectable for tests
 * @returns {{kind: 'isolated-container', sessionId: string} | {kind: 'container', runtime: string|null} | {kind: 'host'}}
 */
export const describeLogFileLocation = ({ env = process.env, detectContext = detectExecutionContext } = {}) => {
  const sessionId = String(env?.HIVE_MIND_PARENT_SESSION_ID || '').trim();
  if (sessionId) return { kind: 'isolated-container', sessionId };
  const context = detectContext({ env });
  if (context?.inContainer) return { kind: 'container', runtime: context.runtime || null };
  return { kind: 'host' };
};

/**
 * Markdown that tells the reader how to reach `logFile` given where it lives.
 * @param {string} logFile
 * @param {Object} location - {@link describeLogFileLocation} result
 * @returns {string}
 */
const formatLogLocationSection = (logFile, location) => {
  if (location?.kind === 'isolated-container') {
    const id = location.sessionId;
    return `The complete log was written inside the isolated Docker container of session \`${id}\`:
\`\`\`
${logFile}
\`\`\`
That path exists only inside the container, not on the host. The container is removed when the session finishes successfully and kept when it fails; while it is kept, copy the log out on the host with:
\`\`\`bash
docker cp "${id}:${logFile}" .
\`\`\`
The console output of the session stays on the host either way: send \`/log ${id}\` to the Telegram bot, or run \`$ --status ${id}\` on the host to find its log file.`;
  }
  const where = location?.kind === 'container' ? `inside the ${location.runtime ? `${location.runtime} ` : ''}container that ran this session (the path exists only while that container exists)` : 'on the machine that ran this session';
  return `The complete log is kept ${where}:
\`\`\`
${logFile}
\`\`\``;
};

/**
 * Console lines for the same information, printed next to the upload error.
 * @param {string} logFile
 * @param {Object} [location] - {@link describeLogFileLocation} result
 * @returns {Array<string>}
 */
export const formatLogLocationConsoleLines = (logFile, location = describeLogFileLocation()) => {
  if (location?.kind === 'isolated-container') {
    const id = location.sessionId;
    return [`  📁 Full log remains available inside isolated container ${id} at: ${logFile}`, `  ℹ️  The container is removed when the session succeeds; the host keeps the console log (/log ${id} in Telegram, or $ --status ${id}).`];
  }
  if (location?.kind === 'container') return [`  📁 Full log remains available inside this ${location.runtime ? `${location.runtime} ` : ''}container at: ${logFile}`];
  return [`  📁 Full log remains available locally at: ${logFile}`];
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
 * @param {Object} [params.location] - Where `logFile` lives ({@link describeLogFileLocation}).
 * @returns {string}
 */
export const buildLogUploadFailureComment = ({ errorMessage = null, failureReason = null, attempts = null, logSizeBytes, logFile, isPublic = true, failureAction = '', location = describeLogFileLocation() }) => {
  const heading = errorMessage ? `## 🚨 ${SOLUTION_DRAFT_FAILED_MARKER}\nThe automated solution draft encountered an error:\n\`\`\`\n${errorMessage}\n\`\`\`${failureAction || ''}\n\n### ⚠️ ${LOG_UPLOAD_FAILED_MARKER}` : `## ⚠️ ${SOLUTION_DRAFT_LOG_MARKER}: ${LOG_UPLOAD_FAILED_MARKER}`;
  const attemptText = attempts > 1 ? ` after ${attempts} attempts` : '';
  const reason = failureReason ? `\n\nLast upload error:\n\`\`\`\n${failureReason}\n\`\`\`` : '';
  return `${heading}
The complete ${errorMessage ? 'failure' : 'working session'} log (${formatSize(logSizeBytes)}) could not be uploaded${attemptText}, so it is not attached here. A partial log is not posted instead, because it could be mistaken for the complete trace.${reason}

${formatLogLocationSection(logFile, location)}
To publish it from there:
\`\`\`bash
gh-upload-log "${logFile}" ${isPublic ? '--public' : '--private'}
\`\`\`

---
*${NOW_WORKING_SESSION_IS_ENDED_MARKER}, feel free to review and add any feedback on the solution draft.*`;
};

/**
 * Issue #2400: "Log Upload Failed" comments already posted by this process,
 * keyed by target. On link-assistant/hive-mind#2398 the same log failed the same
 * way twice: once when the session ended (15:03:57) and again when the
 * `--attach-logs` safety net retried it (15:06:44). A "✅ Ready to merge"
 * comment was posted in between, so the "latest comment is already a failure
 * report" check from issue #2397 did not apply, and the pull request got two
 * byte-identical failure comments. The retry is kept, because a later attempt
 * can succeed; only the repeated report is suppressed.
 */
const reportedLogUploadFailures = new Map();

const failureTargetKey = ({ owner, repo, targetType = 'pr', targetNumber }) => `${owner}/${repo}#${targetType}:${targetNumber}`;
const failureReportKey = ({ logFile, errorMessage }) => `${logFile || ''}\u0000${errorMessage || ''}`;

/**
 * Forget the failure reports of one target, e.g. after its log was attached, so
 * a later failure is reported again. Without a target, forgets every report
 * (tests).
 * @param {Object} [target] - `{owner, repo, targetType, targetNumber}`
 */
export const forgetLogUploadFailureReports = target => {
  if (!target) reportedLogUploadFailures.clear();
  else reportedLogUploadFailures.delete(failureTargetKey(target));
};

/**
 * Post {@link buildLogUploadFailureComment}. Never throws: a failed post is
 * logged and reported as `false`.
 *
 * A failure that was already reported on the same target for the same log file
 * and the same session error is not posted again (issue #2400); that case
 * returns `true`, because the target already says the log is not attached.
 * @returns {Promise<boolean>} Whether the target carries the report.
 */
export const postLogUploadFailureComment = async ({ $, owner, repo, targetNumber, targetType = 'pr', log, postComment = postTrackedCommentFromFile, ...commentParams }) => {
  const targetKey = failureTargetKey({ owner, repo, targetType, targetNumber });
  const reportKey = failureReportKey(commentParams);
  const earlier = reportedLogUploadFailures.get(targetKey)?.get(reportKey);
  if (earlier) {
    await log(`  ℹ️  The "${LOG_UPLOAD_FAILED_MARKER}" comment for this log is already on ${targetType === 'pr' ? 'the pull request' : 'the issue'}${earlier.commentId ? ` (comment id=${earlier.commentId})` : ''}; not posting it again`);
    return true;
  }
  const bodyFile = `/tmp/log-upload-failed-comment-${targetType}-${Date.now()}.md`;
  try {
    await writeSanitizedPublicationFile(bodyFile, buildLogUploadFailureComment(commentParams));
    const posted = await postComment({ $, owner, repo, targetNumber, bodyFile });
    if (posted?.ok) {
      await log(`  📝 Posted a "${LOG_UPLOAD_FAILED_MARKER}" comment explaining why the log is not attached${posted.commentId ? ` (comment id=${posted.commentId})` : ''}`);
      if (!reportedLogUploadFailures.has(targetKey)) reportedLogUploadFailures.set(targetKey, new Map());
      reportedLogUploadFailures.get(targetKey).set(reportKey, { commentId: posted.commentId || null });
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
