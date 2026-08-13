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

export function formatStartingWorkSessionMessage({ sessionName = null, isolationBackend = null, infoBlock = '', locale = null } = {}) {
  const header = text(locale, 'telegram.work_session_starting', '🔄 Starting...');
  const details = infoBlock ? `\n\n${infoBlock}` : '';
  // Issue #1946: for isolation backends the session UUID is known *before* the
  // (potentially long, multi-GB) container/image preparation finishes, so
  // surface it together with the isolation backend right away. This makes the
  // session addressable by /watch, /log and /status while it is still starting,
  // instead of leaving an info-less "Starting..." up for the whole image pull.
  if (!sessionName) return `${header}${details}`;
  const sessionLabel = text(locale, 'telegram.session_label', 'Session');
  const isolationLabel = text(locale, 'telegram.isolation_label', 'Isolation');
  const isolationInfo = isolationBackend ? `\n🔒 ${isolationLabel}: \`${isolationBackend}\`` : '';
  return `${header}\n\n📊 ${sessionLabel}: \`${sessionName}\`${isolationInfo}${details}`;
}

export function formatExecutingWorkSessionMessage({ sessionName = 'unknown', executionUuid = null, isolationBackend = null, infoBlock = '', locale = null } = {}) {
  const sessionLabel = text(locale, 'telegram.session_label', 'Session');
  const isolationLabel = text(locale, 'telegram.isolation_label', 'Isolation');
  const isolationInfo = isolationBackend ? `\n🔒 ${isolationLabel}: \`${isolationBackend}\`` : '';
  const details = infoBlock ? `\n\n${infoBlock}` : '';
  // Issue #2154: `$ --list` identifies an execution by start-command's own UUID,
  // which is *not* the session name shown above it. Printing only one of the two
  // left the operator unable to match a running task to the session list. The
  // line is omitted entirely when start-command reported no UUID, so a session
  // never carries an empty label.
  const executionLabel = text(locale, 'telegram.execution_label', 'Execution');
  const executionInfo = executionUuid ? `\n🆔 ${executionLabel}: \`${executionUuid}\`` : '';
  return `${text(locale, 'telegram.work_session_executing', '⏳ Executing...')}\n\n📊 ${sessionLabel}: \`${sessionName}\`${executionInfo}${isolationInfo}${details}`;
}

/**
 * Render the reply for a work session that never started (issue #2154).
 *
 * The previous reply was the raw runner error in a code fence and nothing else.
 * Two things were missing, and both were reported as separate symptoms of the
 * same incident:
 *
 *   - **The session UUID.** It was generated before the launch and shown in the
 *     "🔄 Starting..." message, but the failure reply *overwrote* that message,
 *     so the only identifier the task ever had was destroyed by its own error
 *     report. Nothing then connected the Telegram thread to the bot log lines,
 *     to the session store, or to a `--log <uuid>` lookup.
 *   - **Why the task is missing from `--list`.** A failed launch produces no
 *     container, so the session is untracked and never appears in the listing.
 *     Without saying so, the reply reads as if the task were running somewhere.
 *
 * @param {Object} params
 * @param {string} [params.commandName] - Command the user invoked (`solve`, `hive`, …)
 * @param {string|null} [params.sessionName] - Session UUID, when one was generated
 * @param {string|null} [params.isolationBackend]
 * @param {string} [params.infoBlock]
 * @param {string} [params.error] - Runner error text
 * @param {string|null} [params.locale]
 * @returns {string} Markdown reply
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 */
export function formatFailedLaunchMessage({ commandName = 'command', sessionName = null, isolationBackend = null, infoBlock = '', error = '', locale = null } = {}) {
  const header = text(locale, 'telegram.error_executing_command', `❌ Error executing ${commandName} command`, { commandName });
  const sessionLabel = text(locale, 'telegram.session_label', 'Session');
  const isolationLabel = text(locale, 'telegram.isolation_label', 'Isolation');
  const sessionLine = sessionName ? `\n📊 ${sessionLabel}: \`${sessionName}\`` : '';
  const isolationLine = isolationBackend ? `\n🔒 ${isolationLabel}: \`${isolationBackend}\`` : '';
  const body = String(error ?? '').trim() || 'unknown error';
  const notLaunched = sessionName ? `\n\n${text(locale, 'telegram.work_session_not_launched', 'The work session was not launched, so it has no log and is not listed by `--list`.')}` : '';
  const details = infoBlock ? `\n\n${infoBlock}` : '';
  return `${header}:${sessionLine}${isolationLine}\n\n\`\`\`\n${body}\n\`\`\`${notLaunched}${details}`;
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

export function formatSessionCompletionMessage({ sessionName, sessionInfo, statusResult = null, observedEndTime = new Date(), exitCode = null, infoBlock = '', pullRequestUrl = null, pullRequestState = null, extraSections = [], locale = null } = {}) {
  const finalExitCode = getSessionCompletionExitCode({ exitCode, statusResult });
  const outcome = classifySessionOutcome({ exitCode: finalExitCode, status: statusResult?.status || null });
  const { failed, killed, signal } = outcome;
  const messageLocale = locale || sessionInfo?.locale || null;
  // Issue #1927: a killed session (OOM/SIGKILL/SIGTERM) must never read as a
  // success, and the signal/reason is surfaced explicitly so an operator can
  // tell an out-of-memory kill apart from an ordinary non-zero exit.
  // Issue #2052: when the operator explicitly requested a stop (e.g. Telegram
  // `/stop <uuid>` → `docker stop` → SIGTERM then SIGKILL), the resulting signal
  // exit (143/137) must NOT read as "out of memory or forced kill". A user stop
  // is an orderly, intentional termination, so surface it as such regardless of
  // which signal actually delivered the kill.
  const stopRequestedByUser = Boolean(sessionInfo?.stopRequestedByUser);
  const pullRequestMerged = pullRequestState?.merged === true || Boolean(pullRequestState?.mergedAt);
  let statusEmojiOverride = null;
  let statusText;
  if (killed && stopRequestedByUser) {
    const showCode = finalExitCode !== null && !(!signal && finalExitCode === 1);
    const exitSuffix = showCode ? ` (exit code: ${finalExitCode})` : '';
    const requestedBy = sessionInfo?.stopRequestedBy ? ` by ${sessionInfo.stopRequestedBy}` : '';
    statusEmojiOverride = '🛑';
    statusText = text(messageLocale, 'telegram.work_session_stopped', `Work session stopped by user${requestedBy}${exitSuffix}`, { requestedBy, exitCode: finalExitCode ?? '', signal: signal?.signal ?? '', exitSuffix });
  } else if (killed) {
    // A real signal exit is always >128; an exit code of exactly 1 on a
    // status-only kill (process vanished, code unknown) is a synthesized failure
    // sentinel, so suppress the misleading "(exit code: 1)" in that case.
    const showCode = finalExitCode !== null && !(!signal && finalExitCode === 1);
    const exitSuffix = showCode ? ` (exit code: ${finalExitCode})` : '';
    const reason = signal ? signal.reason : 'killed';
    statusText = text(messageLocale, 'telegram.work_session_killed', `Work session ${reason}${exitSuffix}`, { reason, exitCode: finalExitCode ?? '', signal: signal?.signal ?? '', exitSuffix });
  } else if (failed && pullRequestMerged) {
    // Issue #2117: the runner's exit code is still authoritative and must not
    // be hidden, but calling the entire session "failed" contradicts the
    // externally verified result when its pull request has already merged.
    // Describe both outcomes so operators know the requested goal completed
    // and that a later orchestration failure still needs investigation.
    statusEmojiOverride = '⚠️';
    statusText = text(messageLocale, 'telegram.work_session_merged_but_failed', `Pull request merged, but the work session exited with code: ${finalExitCode}`, { exitCode: finalExitCode });
  } else if (failed) {
    statusText = text(messageLocale, 'telegram.work_session_failed', `Work session failed (exit code: ${finalExitCode})`, { exitCode: finalExitCode });
  } else {
    statusText = text(messageLocale, 'telegram.work_session_finished', 'Work session finished successfully');
  }
  const durationLabel = text(messageLocale, 'telegram.duration_label', 'Duration');
  const sessionLabel = text(messageLocale, 'telegram.session_label', 'Session');
  const isolationLabel = text(messageLocale, 'telegram.isolation_label', 'Isolation');
  const isolationInfo = sessionInfo?.isolationBackend ? `\n🔒 ${isolationLabel}: \`${sessionInfo.isolationBackend}\`` : '';
  // Issue #2154: the completion reply is the last word the Telegram thread has
  // on a task, and the handle an operator uses afterwards to fetch its log. Keep
  // start-command's execution UUID (the one `$ --list` prints) next to the
  // session UUID, so the finished task can still be found in the session list.
  const executionLabel = text(messageLocale, 'telegram.execution_label', 'Execution');
  const executionUuid = sessionInfo?.executionUuid || statusResult?.uuid || null;
  const executionInfo = executionUuid ? `\n🆔 ${executionLabel}: \`${executionUuid}\`` : '';
  const startTime = parseDateValue(statusResult?.startTime) || parseDateValue(sessionInfo?.startTime) || observedEndTime;
  const endTime = parseDateValue(statusResult?.endTime) || observedEndTime;
  const durationSeconds = Math.max(0, (endTime.getTime() - startTime.getTime()) / 1000);
  let resolvedInfoBlock = infoBlock || sessionInfo?.infoBlock || '';
  // Issue #1688: When the agent created a PR for an issue-driven /solve, append
  //   a 'Pull request:' line so the completion message includes both Issue and PR links.
  if (pullRequestUrl) resolvedInfoBlock = appendPullRequestLine(resolvedInfoBlock, pullRequestUrl, { locale: messageLocale });
  const details = resolvedInfoBlock ? `\n\n${resolvedInfoBlock}` : '';

  const statusEmoji = statusEmojiOverride || (failed ? '❌' : '✅');
  let message = `${statusEmoji} *${statusText}*\n\n`;
  message += `⏱️ ${durationLabel}: ${formatSessionDurationSeconds(durationSeconds)}\n`;
  message += `📊 ${sessionLabel}: \`${sessionName || 'unknown'}\`${executionInfo}${isolationInfo}${details}`;

  // Issue #594: --show-limits virtual option appends snapshot/delta sections
  // (Markdown code blocks) below the standard completion details.
  const mergedWithRunnerFailureSection = failed && !killed && pullRequestMerged ? [`✅ ${text(messageLocale, 'telegram.work_session_merged_success', 'The requested pull request was merged successfully.')}`, `⚠️ ${text(messageLocale, 'telegram.work_session_runner_also_failed', 'The runner also failed; its exit code is preserved for investigation.')}`].join('\n') : null;
  const extras = [mergedWithRunnerFailureSection, ...(Array.isArray(extraSections) ? extraSections : [])].filter(Boolean);
  if (extras.length > 0) {
    message += `\n\n${extras.join('\n\n')}`;
  }

  return message;
}
