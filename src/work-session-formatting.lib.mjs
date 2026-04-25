const FAILURE_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'error']);

function parseDateValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeExitCode(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getSessionCompletionExitCode({ exitCode = null, statusResult = null } = {}) {
  const explicitExitCode = normalizeExitCode(exitCode);
  if (explicitExitCode !== null) return explicitExitCode;

  const statusExitCode = normalizeExitCode(statusResult?.exitCode);
  if (statusExitCode !== null) return statusExitCode;

  const status = String(statusResult?.status || '').toLowerCase();
  if (FAILURE_STATUSES.has(status)) return 1;

  return null;
}

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

export function formatStartingWorkSessionMessage({ infoBlock = '' } = {}) {
  const details = infoBlock ? `\n\n${infoBlock}` : '';
  return `🔄 Starting...${details}`;
}

export function formatExecutingWorkSessionMessage({ sessionName = 'unknown', isolationBackend = null, infoBlock = '' } = {}) {
  const isolationInfo = isolationBackend ? `\n🔒 Isolation: \`${isolationBackend}\`` : '';
  const details = infoBlock ? `\n\n${infoBlock}` : '';
  return `⏳ Executing...\n\n📊 Session: \`${sessionName}\`${isolationInfo}${details}`;
}

export function formatSessionCompletionMessage({ sessionName, sessionInfo, statusResult = null, observedEndTime = new Date(), exitCode = null, infoBlock = '' } = {}) {
  const finalExitCode = getSessionCompletionExitCode({ exitCode, statusResult });
  const failed = finalExitCode !== null && finalExitCode !== 0;
  const statusEmoji = failed ? '❌' : '✅';
  const statusText = failed ? `Work session failed (exit code: ${finalExitCode})` : 'Work session finished successfully';
  const isolationInfo = sessionInfo?.isolationBackend ? `\n🔒 Isolation: \`${sessionInfo.isolationBackend}\`` : '';
  const startTime = parseDateValue(statusResult?.startTime) || parseDateValue(sessionInfo?.startTime) || observedEndTime;
  const endTime = parseDateValue(statusResult?.endTime) || observedEndTime;
  const durationSeconds = Math.max(0, (endTime.getTime() - startTime.getTime()) / 1000);
  const resolvedInfoBlock = infoBlock || sessionInfo?.infoBlock || '';
  const details = resolvedInfoBlock ? `\n\n${resolvedInfoBlock}` : '';

  let message = `${statusEmoji} *${statusText}*\n\n`;
  message += `⏱️ Duration: ${formatSessionDurationSeconds(durationSeconds)}\n`;
  message += `📊 Session: \`${sessionName || 'unknown'}\`${isolationInfo}${details}`;

  return message;
}
