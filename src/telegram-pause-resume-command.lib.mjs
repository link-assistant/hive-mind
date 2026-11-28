/** Commands accept the same task identifiers and replies as /stop. */
import { extractStopTarget, isStopTargetRequester } from './telegram-start-stop-command.lib.mjs';
import { safeReply as defaultSafeReply } from './telegram-safe-reply.lib.mjs';
import { resolveLocaleFromTelegramCtx, t } from './i18n.lib.mjs';
import { getTelegramCommandArgumentsText } from './telegram-command-text.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import * as sessionMonitor from './session-monitor.lib.mjs';

function stateLabel(state, tr) {
  if (state === 'paused') return tr('telegram.task_state_paused');
  if (state === 'running') return tr('telegram.task_state_running');
  if (state === 'exited' || state === 'created') return tr('telegram.task_state_stopped', { state });
  return state;
}

export function registerPauseResumeCommands(bot, options = {}) {
  const { VERBOSE = false, isOldMessage, isForwarded, isGroupChat, isChatAuthorized, isTopicAuthorized, safeReply = defaultSafeReply, monitor = sessionMonitor, detachHandler = handler => handler, claimUrl, getSolveQueue, isIntakePaused, getStoppedChatRejectMessage } = options;
  const operations = { pause: monitor.pauseTrackedSession, unpause: monitor.unpauseTrackedSession, resume: monitor.resumeStoppedSession, status: monitor.getDockerTaskControlState };
  const visible = (ctx, info) => ctx.chat?.type === 'private' || String(info.chatId) === String(ctx.chat?.id);
  const requester = (ctx, info) => isStopTargetRequester({ userId: ctx.from?.id, sessionInfo: info });

  async function list(ctx, command, reply, tr) {
    const tracked = monitor.getActiveSessions().filter(({ sessionInfo }) => sessionInfo.isolationBackend === 'docker' && visible(ctx, sessionInfo) && requester(ctx, sessionInfo));
    const lines = [];
    for (const { sessionName, sessionInfo } of tracked) {
      // Probe sequentially to avoid flooding Docker when many tasks are tracked.
      // eslint-disable-next-line no-await-in-loop
      const result = await monitor.getDockerTaskControlState(sessionName, { verbose: VERBOSE });
      if (!result.success || result.state === 'removed') continue;
      if ((command === 'pause' && result.state !== 'running') || (command === 'unpause' && result.state !== 'paused') || (command === 'resume' && !['exited', 'created'].includes(result.state))) continue;
      lines.push(`${stateLabel(result.state, tr)} · ${escapeMarkdown(sessionName)}${sessionInfo.url ? `\n${escapeMarkdown(sessionInfo.url)}` : ''}`);
    }
    const heading = command === 'list' ? tr('telegram.task_control_list') : tr('telegram.task_control_usage', { command });
    await reply([heading, ...(lines.length ? lines : [tr('telegram.task_control_empty')])].join('\n\n'));
  }

  async function handle(ctx, command) {
    if (isOldMessage?.(ctx) || isForwarded?.(ctx)) return;
    const locale = resolveLocaleFromTelegramCtx(ctx);
    const tr = (key, params) => t(key, params, { locale });
    const reply = text => safeReply(ctx, text, { parse_mode: 'Markdown', reply_to_message_id: ctx.message?.message_id, fallbackLocale: locale });
    if (ctx.chat?.type !== 'private' && (!isGroupChat?.(ctx) || (!isChatAuthorized?.(ctx.chat.id) && !isTopicAuthorized?.(ctx)))) {
      return reply(tr('telegram.task_control_unauthorized'));
    }
    const args = getTelegramCommandArgumentsText(ctx.message?.text);
    const nameOrUrl = args.split(/(?:^|\s+)--reason(?:\s|$)/, 1)[0].trim();
    const replyTarget = ctx.message?.reply_to_message;
    const target = extractStopTarget(nameOrUrl ? `/${command} ${nameOrUrl}` : '', replyTarget);
    if ((!nameOrUrl && !target.value) || command === 'list') return list(ctx, command, reply, tr);
    const name = /^[a-z\d][a-z\d_.-]*$/i.test(nameOrUrl) ? nameOrUrl : null;
    const entry = name ? monitor.findTrackedSessionByIdentifier(name) : target.kind === 'uuid' ? monitor.findTrackedSessionByIdentifier(target.value) : monitor.findStoppableSessionByUrl(target.value, VERBOSE) || monitor.findStoppableSessionByUrl(target.value, VERBOSE, { includeRetained: true });
    if (!entry) return reply(tr('telegram.task_control_missing'));
    const { sessionName, sessionInfo: info } = entry;
    if (!visible(ctx, info)) return reply(tr('telegram.task_control_unauthorized'));
    if (!requester(ctx, info)) {
      const member = await ctx.telegram.getChatMember(info.chatId, ctx.from?.id).catch(() => null);
      if (member?.status !== 'creator') return reply(tr('telegram.task_control_owner'));
    }
    const requestedBy = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id || '');
    const reason =
      command === 'pause'
        ? args
            .match(/(?:^|\s)--reason\s+(.+)$/s)?.[1]
            ?.trim()
            .slice(0, 300)
        : undefined;
    let release;
    try {
      if (command === 'resume' && info.url) {
        release = claimUrl?.(info.url);
        if (claimUrl && !release) return await reply(tr('telegram.task_control_conflict'));
        const active = await monitor.hasActiveSessionForUrlAsync?.(info.url, VERBOSE, { exceptSessionName: sessionName });
        const queued = getSolveQueue?.()?.findLaunchConflict(info.url, []);
        if (active?.isActive || (queued && ![sessionName, info.sessionId, info.rootSessionName].includes(queued.sessionName))) return await reply(tr('telegram.task_control_conflict'));
      }
      if (command === 'resume' && isIntakePaused?.()) return await reply(getStoppedChatRejectMessage(ctx.chat.id, '/resume'));
      const result = await operations[command](sessionName, { requestedBy, reason, verbose: VERBOSE });
      if (!result.success) return await reply(tr('telegram.task_control_failed', { command, error: escapeMarkdown(result.error) }));
      if (command === 'status') return await reply(`${stateLabel(result.state, tr)} · ${escapeMarkdown(sessionName)}${info.url ? `\n${escapeMarkdown(info.url)}` : ''}`);
      const key = { pause: result.alreadyPaused ? 'already_paused' : 'paused', unpause: result.notPaused ? 'not_paused' : 'unpaused', resume: 'resumed' }[command];
      return await reply(tr(`telegram.task_control_${key}`, { session: escapeMarkdown(result.sessionId) }));
    } finally {
      release?.();
    }
  }

  const handlers = {};
  for (const command of ['pause', 'unpause', 'resume', 'list', 'status']) {
    handlers[command] = detachHandler(ctx => handle(ctx, command));
    bot.command(command, handlers[command]);
  }
  return handlers;
}
