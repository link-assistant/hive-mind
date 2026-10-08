import { getSolveQueue } from './telegram-solve-queue.lib.mjs';
import { safeReply as defaultSafeReply } from './telegram-safe-reply.lib.mjs';
import { buildSolveQueuedMessage } from './telegram-ui-messages.lib.mjs';
import { formatStartingWorkSessionMessage } from './work-session-formatting.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { t } from './i18n.lib.mjs';

/** Admit detached sessions and in-process AI work through the same resource gate. */
export async function submitTelegramWork({ ctx, command, commandAlias = command, args = [], url = args[0], tool = 'claude', requester = '', infoBlock = '', perCommandIsolation = null, urlContext = null, locale = null, verbose = false, queue = getSolveQueue({ verbose }), safeReply = defaultSafeReply, startingText = null, signal = null, execute }) {
  const cancelled = { status: 'cancelled', result: { success: false, error: 'cancelled' } };
  if (signal?.aborted) return cancelled;
  const stats = queue.getStats();
  // Keep the consumer's FIFO choice authoritative while any work is waiting.
  const check = stats.queued > 0 ? await queue.canStartCommand({ tool, locale }) : await queue.reserveStartSlot({ tool, locale });
  if (verbose) console.log(`[VERBOSE] /queue admission: command=${commandAlias} tool=${tool} pending=${stats.queued} canStart=${check.canStart} reserved=${check.startReserved === true} rejected=${check.rejected === true} reason=${check.rejectReason || check.reason || 'none'}`);
  if (check.rejected) {
    const error = check.rejectReason || check.reason || 'Resource limit exceeded';
    await safeReply(ctx, t('telegram.solve_rejected', { infoBlock, reason: escapeMarkdown(error) }, { locale }), { reply_to_message_id: ctx.message.message_id });
    return { status: 'rejected', result: { success: false, error } };
  }
  if (check.canStart && check.startReserved) {
    const message = await safeReply(ctx, startingText || formatStartingWorkSessionMessage({ infoBlock, locale }), { reply_to_message_id: ctx.message.message_id });
    if (signal?.aborted) return cancelled;
    return { status: 'started', result: await execute(message) };
  }
  const text = buildSolveQueuedMessage({ locale, tool, position: (stats.queuedByTool[tool] || 0) + 1, infoBlock, reason: check.reason ? escapeMarkdown(check.reason) : '', command });
  // Install the message before enqueueing: the consumer may run immediately.
  const message = await safeReply(ctx, text, { reply_to_message_id: ctx.message.message_id });
  const item = queue.enqueue({ url, args, ctx, requester, infoBlock, command, commandAlias, tool, perCommandIsolation, urlContext, locale, executeCallback: () => (signal?.aborted ? cancelled.result : execute(message)), managesMessages: true });
  item.messageInfo = { chatId: message.chat.id, messageId: message.message_id, messageThreadId: message.message_thread_id ?? ctx.message?.message_thread_id ?? null };
  if (signal) {
    const cancel = () => queue.cancel(item.id);
    signal.addEventListener('abort', cancel, { once: true });
    item.completion.then(() => signal.removeEventListener('abort', cancel));
    if (signal.aborted) cancel();
  }
  return { status: 'queued', item };
}
