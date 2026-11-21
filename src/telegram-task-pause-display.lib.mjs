import { t } from './i18n.lib.mjs';
import { safeEditMessageText, safeSendMessage } from './telegram-safe-reply.lib.mjs';
import { escapeMarkdown } from './telegram-markdown.lib.mjs';
import { formatExecutingWorkSessionMessage } from './work-session-formatting.lib.mjs';

export async function reportDockerPause({ bot, sessionName, sessionInfo: info, running, verbose, now = Date.now, alertAfterMs = 60 * 60 * 1000, persist }) {
  if (!running || !info.chatId || !bot?.telegram) return;
  const locale = info.locale;
  const state = info.paused ? 'paused' : 'running';
  try {
    if (info.messageId && info.pauseCardState !== state) {
      const message = formatExecutingWorkSessionMessage({ sessionName: info.sessionId || sessionName, executionUuid: info.executionUuid, isolationBackend: 'docker', infoBlock: info.infoBlock, locale, header: info.paused ? t('telegram.task_state_paused', {}, { locale }) : null });
      const edited = await safeEditMessageText(bot.telegram, info.chatId, info.messageId, undefined, message, { parse_mode: 'Markdown', fallbackLocale: locale, verbose }).then(
        () => true,
        error => {
          if (/message is not modified/i.test(error.message)) return true;
          if (verbose) console.log(`[VERBOSE] Could not edit Docker pause card for ${sessionName}: ${error.message}`);
          return false;
        }
      );
      if (edited) {
        info.pauseCardState = state;
        persist();
      }
    }
    const timestamp = now();
    if (info.paused && !info.pauseAlertedAt && timestamp - Date.parse(info.pausedAt) >= alertAfterMs) {
      await safeSendMessage(bot.telegram, info.chatId, t('telegram.task_pause_alert', { session: escapeMarkdown(info.sessionId || sessionName) }, { locale }), { parse_mode: 'Markdown', reply_to_message_id: info.messageId ?? undefined, message_thread_id: info.messageThreadId ?? undefined, fallbackLocale: locale });
      info.pauseAlertedAt = new Date(timestamp).toISOString();
      persist();
    }
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Could not report Docker pause state for ${sessionName}: ${error.message}`);
  }
}
