import { t } from './i18n.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { FAILURE_SESSION_STATUSES, KILLED_SESSION_STATUSES, isKilledSessionStatus, describeExitSignal, normalizeExitCode } from './session-status.lib.mjs';

function text(locale, key, fallback, params = {}) {
  if (!locale) return fallback;
  return t(key, params, { locale });
}

function parseDateValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getSessionCompletionExitCode({ exitCode = null, statusResult = null } = {}) {
  const explicitExitCode = normalizeExitCode(exitCode);
  if (explicitExitCode !== null) return explicitExitCode;

  const statusExitCode = normalizeExitCode(statusResult?.exitCode);
  if (statusExitCode !== null) return statusExitCode;

  const status = String(statusResult?.status || '').toLowerCase();
  if (FAILURE_SESSION_STATUSES.has(status)) return 1;

  return null;
}

/**
 * Decide how a completed session should be presented: success, generic failure,
 * or an explicit kill (OOM/SIGKILL/SIGTERM/…). A session counts as "killed"
 * when its exit code is a signal exit (>128) or its status is one of the kill
 * statuses. This is what stops a SIGKILLed /solve from ever being labelled
 * "finished successfully" (issue #1927, requirement #1).
 *
 * @param {Object} params
 * @param {number|null} params.exitCode - Resolved final exit code
 * @param {string|null} [params.status] - Session status string, if known
 * @returns {{ failed: boolean, killed: boolean, signal: object|null }}
 */
export function classifySessionOutcome({ exitCode = null, status = null } = {}) {
  const code = normalizeExitCode(exitCode);
  const signal = describeExitSignal(code);
  const killedByStatus = isKilledSessionStatus(status);
  const killed = Boolean(signal) || killedByStatus;
  const failed = killed || (code !== null && code !== 0) || FAILURE_SESSION_STATUSES.has(String(status || '').toLowerCase());
  return { failed, killed, signal };
}

export { KILLED_SESSION_STATUSES };

export function formatSessionDurationSeconds(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const parts = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);

  return parts.join(' ');
}

export function formatStartingWorkSessionMessage({ infoBlock = '', locale = null } = {}) {
  const details = infoBlock ? `\n\n${infoBlock}` : '';
  return `${text(locale, 'telegram.work_session_starting', '🔄 Starting...')}${details}`;
}

export function formatExecutingWorkSessionMessage({ sessionName = 'unknown', isolationBackend = null, infoBlock = '', locale = null } = {}) {
  const sessionLabel = text(locale, 'telegram.session_label', 'Session');
  const isolationLabel = text(locale, 'telegram.isolation_label', 'Isolation');
  const isolationInfo = isolationBackend ? `\n🔒 ${isolationLabel}: \`${isolationBackend}\`` : '';
  const details = infoBlock ? `\n\n${infoBlock}` : '';
  return `${text(locale, 'telegram.work_session_executing', '⏳ Executing...')}\n\n📊 ${sessionLabel}: \`${sessionName}\`${isolationInfo}${details}`;
}

/**
 * Append an extra "Pull request:" line to an existing infoBlock when an issue's
 * /solve session has produced a PR. Idempotent — already present URLs are not
 * duplicated.
 *
 * @param {string} infoBlock - Existing infoBlock (already contains an Issue: line)
 * @param {string|null} pullRequestUrl - PR URL discovered after the session completed
 * @returns {string} New infoBlock
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1688
 */
export function appendPullRequestLine(infoBlock, pullRequestUrl, { locale = null } = {}) {
  if (!pullRequestUrl || !infoBlock) return infoBlock || '';
  if (infoBlock.includes(pullRequestUrl) || infoBlock.includes(escapeMarkdown(pullRequestUrl))) return infoBlock;

  const lines = infoBlock.split('\n');
  let lastUrlLineIdx = -1;
  const urlLabels = ['Issue', 'Pull request', 'URL'];
  if (locale) {
    urlLabels.push(t('telegram.info_issue_label', {}, { locale }));
    urlLabels.push(t('telegram.info_pull_request_label', {}, { locale }));
    urlLabels.push(t('telegram.info_url_label', {}, { locale }));
  }
  for (let i = 0; i < lines.length; i++) {
    if (urlLabels.some(label => lines[i].startsWith(`${label}: `))) {
      lastUrlLineIdx = i;
    }
  }
  // Issue #1801: escape underscores/asterisks so Markdown parser doesn't open
  //   an entity on URLs like .../save_visiogetbb/pull/8 that the Issue: line
  //   above already had escaped at buildTelegramInfoBlock time.
  const prLine = `${text(locale, 'telegram.info_pull_request_label', 'Pull request')}: ${escapeMarkdown(pullRequestUrl)}`;
  if (lastUrlLineIdx === -1) {
    return `${infoBlock}\n${prLine}`;
  }
  const before = lines.slice(0, lastUrlLineIdx + 1);
  const after = lines.slice(lastUrlLineIdx + 1);
  return [...before, prLine, ...after].join('\n');
}

export function formatSessionCompletionMessage({ sessionName, sessionInfo, statusResult = null, observedEndTime = new Date(), exitCode = null, infoBlock = '', pullRequestUrl = null, extraSections = [], locale = null } = {}) {
  const finalExitCode = getSessionCompletionExitCode({ exitCode, statusResult });
  const outcome = classifySessionOutcome({ exitCode: finalExitCode, status: statusResult?.status || null });
  const { failed, killed, signal } = outcome;
  const statusEmoji = failed ? '❌' : '✅';
  const messageLocale = locale || sessionInfo?.locale || null;
  // Issue #1927: a killed session (OOM/SIGKILL/SIGTERM) must never read as a
  // success, and the signal/reason is surfaced explicitly so an operator can
  // tell an out-of-memory kill apart from an ordinary non-zero exit.
  let statusText;
  if (killed) {
    // A real signal exit is always >128; an exit code of exactly 1 on a
    // status-only kill (process vanished, code unknown) is a synthesized failure
    // sentinel, so suppress the misleading "(exit code: 1)" in that case.
    const showCode = finalExitCode !== null && !(!signal && finalExitCode === 1);
    const exitSuffix = showCode ? ` (exit code: ${finalExitCode})` : '';
    const reason = signal ? signal.reason : 'killed';
    statusText = text(messageLocale, 'telegram.work_session_killed', `Work session ${reason}${exitSuffix}`, { reason, exitCode: finalExitCode ?? '', signal: signal?.signal ?? '' });
  } else if (failed) {
    statusText = text(messageLocale, 'telegram.work_session_failed', `Work session failed (exit code: ${finalExitCode})`, { exitCode: finalExitCode });
  } else {
    statusText = text(messageLocale, 'telegram.work_session_finished', 'Work session finished successfully');
  }
  const durationLabel = text(messageLocale, 'telegram.duration_label', 'Duration');
  const sessionLabel = text(messageLocale, 'telegram.session_label', 'Session');
  const isolationLabel = text(messageLocale, 'telegram.isolation_label', 'Isolation');
  const isolationInfo = sessionInfo?.isolationBackend ? `\n🔒 ${isolationLabel}: \`${sessionInfo.isolationBackend}\`` : '';
  const startTime = parseDateValue(statusResult?.startTime) || parseDateValue(sessionInfo?.startTime) || observedEndTime;
  const endTime = parseDateValue(statusResult?.endTime) || observedEndTime;
  const durationSeconds = Math.max(0, (endTime.getTime() - startTime.getTime()) / 1000);
  let resolvedInfoBlock = infoBlock || sessionInfo?.infoBlock || '';
  // Issue #1688: When the agent created a PR for an issue-driven /solve, append
  //   a 'Pull request:' line so the completion message includes both Issue and PR links.
  if (pullRequestUrl) resolvedInfoBlock = appendPullRequestLine(resolvedInfoBlock, pullRequestUrl, { locale: messageLocale });
  const details = resolvedInfoBlock ? `\n\n${resolvedInfoBlock}` : '';

  let message = `${statusEmoji} *${statusText}*\n\n`;
  message += `⏱️ ${durationLabel}: ${formatSessionDurationSeconds(durationSeconds)}\n`;
  message += `📊 ${sessionLabel}: \`${sessionName || 'unknown'}\`${isolationInfo}${details}`;

  // Issue #594: --show-limits virtual option appends snapshot/delta sections
  // (Markdown code blocks) below the standard completion details.
  const extras = (Array.isArray(extraSections) ? extraSections : []).filter(Boolean);
  if (extras.length > 0) {
    message += `\n\n${extras.join('\n\n')}`;
  }

  return message;
}
