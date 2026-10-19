/** Recovery lifecycle shared by the monitor and in-process retries (#2498). */
import fs from 'node:fs/promises';
import { readLogTailText } from './log-bounded-read.lib.mjs';
import { safeEditMessageText, safeSendMessage } from './telegram-safe-reply.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';

export const RECOVERY_HEARTBEAT_MS = 5 * 60 * 1000;
export const RECOVERY_LOG_MARKER = '[HIVE-MIND RECOVERY]';

export function recoveryLogLine(event) {
  return `${RECOVERY_LOG_MARKER} ${JSON.stringify({ ...event, at: event.at || new Date().toISOString() })}`;
}

export function parseRecoveryLogEvent(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^(?:\[[^\]]*\] )*\[HIVE-MIND RECOVERY\] (\{.*\})\r?$/.exec(lines[i]);
    if (!match) continue;
    try {
      const event = JSON.parse(match[1]);
      if (event.kind === 'tool' && Number.isSafeInteger(event.attempt) && event.attempt > 0 && ['waiting', 'launching', 'running', 'completed', 'failed', 'cancelled'].includes(event.phase) && Number.isFinite(Date.parse(event.at))) return event;
    } catch {
      // Tool output may contain malformed or quoted markers.
    }
  }
  return null;
}

/** @telegram-markdown Telegram legacy-Markdown text (issue #3505). */
export function formatRecoveryLifecycle({ phase, attempt = null, maxAttempts = null, sessionName = null, previousSession = null, executionUuid = null, at, startedAt = null, lastOutputAt = null, logAvailable = false, delayMs = null, exitCode = null, reason = null, nextSession = null, kind = 'container', outerTerminal = false, resourceState = null, waitedMs = null } = {}) {
  const titles = { waiting: '⏳ Recovery scheduled', 'waiting-resources': '⏳ Recovery pending — waiting for free and stable resources', launching: '🔄 Recovery attempt launching — outcome pending', running: '🔄 Recovery attempt under monitoring — outcome pending', completed: '✅ Recovery attempt completed successfully', failed: '❌ Recovery attempt failed', stopped: '🛑 Recovery stopped by user', cancelled: '✅ Recovery cancelled — work already complete', unknown: '⚠️ Recovery session stopped — outcome unknown' };
  const lines = [`${titles[phase] || titles.running}${attempt ? ` (attempt ${attempt}${maxAttempts ? `/${maxAttempts}` : ''})` : ''}`, `Updated: ${escapeMarkdown(at)}`];
  if (startedAt) lines.push(`Attempt started: ${escapeMarkdown(startedAt)}`);
  if (sessionName) lines.push(`Recovery session: ${escapeMarkdown(sessionName)}`);
  if (previousSession) lines.push(`Previous session: ${escapeMarkdown(previousSession)}`);
  if (executionUuid) lines.push(`Execution / log: ${escapeMarkdown(executionUuid)}`);
  if (delayMs !== null) lines.push(`Waiting ${Math.round(delayMs / 1000)} seconds before launch.`);
  // Issue #3530: the recovery waits behind the task queue's resource gate.
  if (phase === 'waiting-resources') {
    lines.push(resourceState === 'stabilizing' ? 'Resources are available; checking that they stay stable before the launch.' : 'The host does not have enough free resources yet; the recovery starts once they are free and stable.');
    if (Number.isFinite(waitedMs) && waitedMs > 0) lines.push(`Waiting for ${Math.round(waitedMs / 60000)} min so far.`);
  }
  if (phase === 'running') {
    lines.push(lastOutputAt ? `Execution log output observed at ${escapeMarkdown(lastOutputAt)}. Output alone does not establish commits or task progress.` : logAvailable ? 'No new execution output has been observed since monitoring this attempt began.' : 'The execution log is unavailable; activity cannot be confirmed.');
    lines.push('No terminal outcome is confirmed. A quiet run may still be working or stalled.');
  }
  if (exitCode !== null) lines.push(`This attempt exited with code ${exitCode}.`);
  if (reason) lines.push(`Reason: ${escapeMarkdown(String(reason).slice(0, 500))}`);
  if (phase === 'cancelled') lines.push('No recovery attempt was launched.');
  if (nextSession) lines.push(`A further recovery was launched as ${escapeMarkdown(nextSession)}; its outcome is pending.`);
  else if (['failed', 'stopped'].includes(phase) && kind === 'container') lines.push('This attempt has stopped. No replacement session was launched.');
  if (kind === 'tool' && ['completed', 'failed'].includes(phase)) lines.push(outerTerminal ? 'This is the final outcome of the enclosing solve run.' : 'This is the AI tool attempt result; the enclosing solve run is still under monitoring and reports its own final outcome.');
  return lines.join('\n');
}

/** Best-effort reporting never changes a task's execution or outcome. */
export async function reportRecoveryLifecycle({ bot, sessionName, sessionInfo, statusResult = null, running = true, exitCode = null, nextSession = null, phase = null, attempt = null, maxAttempts = null, delayMs = null, reason = null, resourceState = null, waitedMs = null, options = {}, verbose = false, persist = () => {}, logEvent = () => {} } = {}) {
  try {
    const now = options.recoveryNow ? options.recoveryNow() : Date.now();
    const at = new Date(now).toISOString();
    const logPath = statusResult?.logPath || sessionInfo?.logPath || null;
    let state = sessionInfo.recoveryLifecycle;
    if (phase && attempt && (state?.kind !== 'container' || state?.attempt !== attempt)) state = { kind: 'container', attempt, startedAt: at, commentUrl: state?.commentUrl, lastReportedMs: 0 };
    const event = phase ? null : parseRecoveryLogEvent(await readLogTailText(logPath, { maxBytes: 32768, minByteOffset: sessionInfo?.killRecoveryInPlace ? sessionInfo.killRecoveryLogStartBytes || 0 : 0 }));
    if (event && (!state || state.kind !== 'tool' || event.attempt !== state.attempt)) state = { kind: 'tool', attempt: event.attempt, startedAt: event.startedAt || event.at, commentUrl: event.commentUrl || state?.commentUrl, lastReportedMs: 0 };
    if (!state && (sessionInfo.killRecoveryResumed || phase)) state = { kind: 'container', attempt: sessionInfo.killRecoveryAttempts || 1, startedAt: sessionInfo.killRecoveryStartedAt || new Date(sessionInfo.startTime).toISOString(), lastReportedMs: 0, lastBytes: sessionInfo.killRecoveryLogStartBytes ?? null };
    if (!state) return null;
    if (event) state.lastToolEvent = { phase: event.phase, exitCode: event.exitCode ?? null, reason: event.reason ? String(event.reason).slice(0, 500) : null };
    // Later solve output can move the tool result outside our bounded tail.
    const toolEvent = event || (state.kind === 'tool' ? state.lastToolEvent : null);
    const stat = logPath ? await fs.stat(logPath).catch(() => null) : null;
    if (stat && Number.isFinite(state.lastBytes) && stat.size > state.lastBytes) {
      const added = await readLogTailText(logPath, { maxBytes: 32768, minByteOffset: state.lastBytes });
      // Our own heartbeats prove the retry is pending, not agent activity.
      if (added.split('\n').some(line => line.trim() && !line.includes(RECOVERY_LOG_MARKER))) state.lastOutputAt = new Date(stat.mtimeMs).toISOString();
    }
    if (stat) state.lastBytes = stat.size;
    const eventPhase = toolEvent?.phase === 'launching' ? 'running' : toolEvent?.phase;
    const nextPhase = phase || (nextSession ? 'launching' : !running ? (sessionInfo.stopRequestedByUser ? 'stopped' : toolEvent?.phase === 'cancelled' ? 'cancelled' : exitCode === null ? 'unknown' : exitCode === 0 ? 'completed' : 'failed') : eventPhase || 'running');
    const changed = state.phase !== nextPhase || state.outerTerminal !== !running || (reason && state.reason !== reason);
    const due = !state.lastReportedMs || now - state.lastReportedMs >= RECOVERY_HEARTBEAT_MS;
    const terminal = ['completed', 'failed', 'stopped', 'unknown', 'cancelled'].includes(nextPhase);
    sessionInfo.recoveryLifecycle = state;
    if (!changed && (!due || (terminal && !running))) {
      persist();
      return null;
    }
    if (maxAttempts) state.maxAttempts = maxAttempts;
    const report = { ...state, phase: nextPhase, outerTerminal: !running, at, resourceState, waitedMs, sessionName, previousSession: sessionInfo.killRecoveryOfSession || null, executionUuid: sessionInfo.executionUuid || statusResult?.uuid || null, logAvailable: Boolean(stat), delayMs, exitCode: !running ? exitCode : (toolEvent?.exitCode ?? null), reason: reason || toolEvent?.reason || statusResult?.exitReason || null, nextSession };
    const text = formatRecoveryLifecycle(report);
    logEvent('session_recovery_lifecycle', report);
    if (logPath) await fs.appendFile(logPath, `\n${recoveryLogLine({ ...report, kind: 'container' })}\n`).catch(error => console.warn(`[session-recovery] Could not append lifecycle report: ${error?.message || error}`));
    // Issue #3530: the lifecycle is Telegram only. GitHub gets the one kill
    // comment (edited once the recovery starts) and the recovery's own start
    // comment; the auto-updating lifecycle comment flooded pull requests.
    let telegramDelivered = !running || !bot?.telegram;
    // Terminal reports are appended to the normal completion message by the
    // caller. Active reports keep updating the original Telegram task reply.
    if (running && bot?.telegram) {
      try {
        const message = `${text}\n\n${sessionInfo.infoBlock || ''}`;
        const notificationOptions = { parse_mode: 'Markdown', locale: sessionInfo.locale, verbose };
        if (sessionInfo.messageId) await safeEditMessageText(bot.telegram, sessionInfo.chatId, sessionInfo.messageId, undefined, message, notificationOptions);
        else {
          const sent = await safeSendMessage(bot.telegram, sessionInfo.chatId, message, notificationOptions);
          if (sent?.message_id) sessionInfo.messageId = sent.message_id;
        }
        telegramDelivered = true;
      } catch (error) {
        if (/message is not modified/i.test(error?.message || '')) telegramDelivered = true;
        else console.warn(`[session-recovery] Telegram update failed for ${sessionName}: ${error?.message || error}`);
      }
    }
    // A failed publication is retried next tick; a bot restart retains the
    // comment handle and throttle, so it does not create another heartbeat.
    if (telegramDelivered) {
      state.lastReportedMs = now;
      state.phase = nextPhase;
      state.outerTerminal = !running;
      state.reason = reason;
    }
    persist();
    return text;
  } catch (error) {
    console.warn(`[session-recovery] Lifecycle reporting failed for ${sessionName}: ${error?.message || error}`);
    return null;
  }
}

/** Used before launch so a delayed recovery is visible in Telegram and the log. */
export function recoveryLifecycleCallback(context) {
  return async event => {
    const logPath = context.sessionInfo?.logPath;
    if (logPath) await fs.appendFile(logPath, `\n${recoveryLogLine({ kind: 'container', ...event })}\n`).catch(error => console.warn(`[session-recovery] Could not append lifecycle record: ${error?.message || error}`));
    return reportRecoveryLifecycle({ ...context, ...event });
  };
}
