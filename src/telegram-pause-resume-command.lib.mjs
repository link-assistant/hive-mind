/** Telegram task pause/resume, addressed by UUID, issue/PR URL, or a reply. */
import { extractStopTarget, isStopTargetRequester } from './telegram-start-stop-command.lib.mjs';
import { safeReply as defaultSafeReply } from './telegram-safe-reply.lib.mjs';
import * as sessionMonitor from './session-monitor.lib.mjs';

export function registerPauseResumeCommands(bot, options = {}) {
  const { VERBOSE = false, isOldMessage, isForwarded, isGroupChat, isChatAuthorized, isTopicAuthorized, safeReply = defaultSafeReply, monitor = sessionMonitor } = options;

  async function handle(ctx, command) {
    if (isOldMessage?.(ctx) || isForwarded?.(ctx)) return;
    const reply = text => safeReply(ctx, text, { reply_to_message_id: ctx.message?.message_id });
    if (ctx.chat?.type !== 'private') {
      if (!isGroupChat?.(ctx) || (!isChatAuthorized?.(ctx.chat.id) && !isTopicAuthorized?.(ctx))) {
        await reply('❌ This chat is not authorized to control tasks.');
        return;
      }
    }
    const target = extractStopTarget(ctx.message?.text, ctx.message?.reply_to_message);
    if (!target.value) {
      const paused = command === 'resume' ? monitor.getPausedSessions().filter(({ sessionInfo }) => isStopTargetRequester({ userId: ctx.from?.id, sessionInfo }) && (ctx.chat.type === 'private' || sessionInfo.chatId === ctx.chat.id)) : [];
      const listing = paused.map(({ sessionName, sessionInfo }) => `${sessionName}\n${sessionInfo.url || ''}`).join('\n\n');
      await reply(`Usage: /${command} <session UUID or issue/PR URL>, or reply to a task message with /${command}.${listing ? `\n\nYour paused tasks:\n${listing}` : ''}`);
      return;
    }
    const entry = target.kind === 'uuid' ? monitor.findControllableSession(target.value) : monitor.findStoppableSessionByUrl(target.value, VERBOSE);
    if (!entry) {
      await reply('ℹ️ No tracked task found for this UUID or URL.');
      return;
    }
    const info = entry.sessionInfo;
    // Never let an owner of one authorized chat control another chat's task.
    if (ctx.chat.type !== 'private' && String(info.chatId) !== String(ctx.chat.id)) {
      await reply('❌ This task belongs to another chat.');
      return;
    }
    if (!isStopTargetRequester({ userId: ctx.from?.id, sessionInfo: info })) {
      try {
        const member = await ctx.telegram.getChatMember(info.chatId, ctx.from.id);
        if (member?.status !== 'creator') {
          await reply(`❌ /${command} is only available to the task requester or the originating chat owner.`);
          return;
        }
      } catch {
        await reply(`❌ Failed to verify permissions for /${command}.`);
        return;
      }
    }
    const identifier = entry.sessionName;
    const requestedBy = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || null;
    if (VERBOSE) console.log(`[VERBOSE] /${command} target=${identifier} requester=${ctx.from?.id}`);
    await reply(`${command === 'pause' ? '⏸️ Stopping' : '▶️ Resuming'} task ${identifier}…`);
    let result;
    try {
      result = await (command === 'pause' ? monitor.pauseTrackedSession(identifier, { requestedBy, verbose: VERBOSE }) : monitor.resumePausedSession(identifier, { verbose: VERBOSE }));
    } catch (error) {
      result = { success: false, error: error.message };
    }
    if (!result.success) {
      await reply(`❌ Failed to ${command} task: ${result.error}`);
    } else if (command === 'pause') {
      await reply(`⏸️ Task ${identifier} ${result.alreadyPaused ? 'is already paused' : 'paused'}. Its container is stopped and its files are preserved.\n\nUse /resume ${identifier} to continue.`);
    } else {
      await reply(`▶️ Task resumed as ${result.sessionId}. Completion monitoring is active.\n\nUse /pause ${identifier} to pause it again.`);
    }
  }
  const handlePauseCommand = ctx => handle(ctx, 'pause');
  const handleResumeCommand = ctx => handle(ctx, 'resume');
  bot.command('pause', handlePauseCommand);
  bot.command('resume', handleResumeCommand);
  return { handlePauseCommand, handleResumeCommand };
}
