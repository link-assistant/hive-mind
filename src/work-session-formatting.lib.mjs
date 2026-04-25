const FAILURE_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'error']);

function capitalizeCommandName(commandName) {
  const normalized = commandName || 'solve';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

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

export function formatExecutingWorkSessionMessage({ commandName = 'solve', sessionName = 'unknown', isolationBackend = null, infoBlock = '' } = {}) {
  const isolationInfo = isolationBackend ? `\n🔒 Isolation: \`${isolationBackend}\`` : '';
  const details = infoBlock ? `\n\n${infoBlock}` : '';
  return `⏳ ${capitalizeCommandName(commandName)} command executing...\n\n📊 Session: \`${sessionName}\`${isolationInfo}${details}`;
}

export function formatSessionCompletionMessage({ sessionName, sessionInfo, statusResult = null, observedEndTime = new Date(), exitCode = null } = {}) {
  const finalExitCode = getSessionCompletionExitCode({ exitCode, statusResult });
  const failed = finalExitCode !== null && finalExitCode !== 0;
  const statusEmoji = failed ? '❌' : '✅';
  const statusText = failed ? `Failed (exit code: ${finalExitCode})` : 'Completed';
  const isolationInfo = sessionInfo?.isolationBackend ? `\n🔒 Isolation: ${sessionInfo.isolationBackend}` : '';
  const startTime = parseDateValue(statusResult?.startTime) || parseDateValue(sessionInfo?.startTime) || observedEndTime;
  const endTime = parseDateValue(statusResult?.endTime) || observedEndTime;
  const durationSeconds = Math.max(0, (endTime.getTime() - startTime.getTime()) / 1000);

  let message = `${statusEmoji} *Work Session ${statusText}*\n\n`;
  message += `📊 Session: \`${sessionName || 'unknown'}\`\n`;
  message += `⏱️ Duration: ${formatSessionDurationSeconds(durationSeconds)}\n`;
  message += `🔗 URL: ${sessionInfo?.url || 'unknown'}${isolationInfo}\n\n`;
  message += 'The work session has finished. You can now review the results.';

  return message;
}
