/**
 * Telegram /models command implementation (issue #2202, R5).
 *
 * Shows the merged model catalogue for a tool: what this installation ships,
 * what the live sources are serving right now, and which of the two a given
 * model is in. Every source it reads is a listing endpoint that cannot bill a
 * token (R7), and the answer is cached for an hour (R9), so asking often is
 * free.
 *
 * Usage in chat:
 *   /models                       -> the default tool (claude)
 *   /models --tool codex          -> one specific tool
 *   /models --all                 -> every tool, one message each
 *   /models --details             -> add context window and pricing (R8)
 *   /models --refresh             -> ignore the cache and re-read the sources
 *   /models --no-update           -> skip the CLI version check (R6)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import { ensureAgenticCliFreshness, describeFreshnessResult } from './agentic-cli-freshness.lib.mjs';
import { MODEL_CATALOGUE_TOOLS, getMergedModelCatalogue } from './model-catalogue.lib.mjs';
import { formatModelCatalogueTelegram } from './model-catalogue-render.lib.mjs';
import { safeReply as defaultSafeReply } from './telegram-safe-reply.lib.mjs';

const GROUP_ONLY_MESSAGE = '❌ The /models command only works in group chats. Please add this bot to a group and make it an admin.';

/** The tool answered when the operator names none — the one Hive Mind drives by default. */
export const DEFAULT_MODELS_COMMAND_TOOL = 'claude';

/**
 * Parse the argument tail of a `/models` message.
 *
 * Deliberately forgiving: a chat is not a shell, so `--tool codex`,
 * `--tool=codex`, and a bare `codex` all mean the same thing. Anything it
 * cannot make sense of comes back as `error` so the handler can say so instead
 * of silently answering a different question.
 */
export const parseModelsCommandArgs = (text = '') => {
  const result = { tools: [], all: false, refresh: false, details: false, update: true, error: null };
  const tokens = String(text).trim().split(/\s+/).slice(1).filter(Boolean);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (lower === '--all' || lower === 'all') {
      result.all = true;
      continue;
    }
    if (lower === '--refresh' || lower === 'refresh') {
      result.refresh = true;
      continue;
    }
    if (lower === '--details' || lower === '--detail' || lower === 'details') {
      result.details = true;
      continue;
    }
    if (lower === '--no-update' || lower === '--no-tool-update') {
      result.update = false;
      continue;
    }
    let value;
    if (lower.startsWith('--tool=')) value = lower.slice('--tool='.length);
    else if (lower === '--tool' || lower === '-t') value = (tokens[++index] ?? '').toLowerCase();
    else if (!lower.startsWith('-')) value = lower;
    else {
      result.error = `Unknown option: ${token}`;
      return result;
    }

    for (const entry of value.split(',').filter(Boolean)) {
      if (!MODEL_CATALOGUE_TOOLS.includes(entry)) {
        result.error = `Unknown tool: ${entry}. Known tools: ${MODEL_CATALOGUE_TOOLS.join(', ')}`;
        return result;
      }
      if (!result.tools.includes(entry)) result.tools.push(entry);
    }
  }

  if (result.all) result.tools = [...MODEL_CATALOGUE_TOOLS];
  if (result.tools.length === 0) result.tools = [DEFAULT_MODELS_COMMAND_TOOL];
  return result;
};

/**
 * Registers the /models command handler with the bot.
 *
 * @param {Object} bot Telegraf bot instance
 * @param {Object} options the shared command options every telegram command takes
 * @returns {{ handleModelsCommand: Function }} the handler, for the text fallback
 */
export function registerModelsCommand(bot, options = {}) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, isGroupChat, isChatAuthorized, isTopicAuthorized, buildAuthErrorMessage, addBreadcrumb, safeReply, loadCatalogue = getMergedModelCatalogue, freshness = ensureAgenticCliFreshness, env = process.env } = options;

  async function handleModelsCommand(ctx) {
    VERBOSE && console.log('[VERBOSE] /models command received');

    if (addBreadcrumb) {
      await addBreadcrumb({
        category: 'telegram.command',
        message: '/models command received',
        level: 'info',
        data: { chatId: ctx.chat?.id, chatType: ctx.chat?.type, userId: ctx.from?.id, username: ctx.from?.username },
      });
    }

    const reply = (text, replyOptions = {}) => (safeReply || defaultSafeReply)(ctx, text, { reply_to_message_id: ctx.message?.message_id, ...replyOptions });

    if (isOldMessage?.(ctx)) {
      VERBOSE && console.log('[VERBOSE] /models ignored: old message');
      return;
    }
    if (isForwardedOrReply?.(ctx)) {
      VERBOSE && console.log('[VERBOSE] /models ignored: forwarded or reply');
      return;
    }
    if (isGroupChat && !isGroupChat(ctx)) {
      VERBOSE && console.log('[VERBOSE] /models ignored: not a group chat');
      await reply(GROUP_ONLY_MESSAGE);
      return;
    }
    const authorize = isTopicAuthorized || (isChatAuthorized ? context => isChatAuthorized(context.chat.id) : () => true);
    if (!authorize(ctx)) {
      VERBOSE && console.log('[VERBOSE] /models ignored: not authorized');
      await reply(buildAuthErrorMessage ? buildAuthErrorMessage(ctx) : `❌ This chat (ID: ${ctx.chat.id}) is not authorized.`);
      return;
    }

    const args = parseModelsCommandArgs(ctx.message?.text ?? '');
    if (args.error) {
      await reply(`❌ ${args.error}`);
      return;
    }

    // R6: give the agentic CLIs a chance to update before we describe what they
    // can run. Best-effort — a failed refresh must not cost the operator their
    // answer, so the outcome is reported and then ignored.
    const refreshed = await freshness({ tools: args.tools, env, enabled: args.update, verbose: VERBOSE, log: async message => VERBOSE && console.log(`[VERBOSE] /models ${message}`) });
    const freshnessLine = describeFreshnessResult(refreshed);
    if (freshnessLine) await reply(freshnessLine);

    for (const tool of args.tools) {
      try {
        const merged = await loadCatalogue({ tool, env, refresh: args.refresh });
        await reply(formatModelCatalogueTelegram(merged, { details: args.details }));
      } catch (error) {
        await reply(`⚠️ Could not build the ${tool} catalogue: ${error?.message ?? error}`);
      }
    }
  }

  bot.command(/^models$/i, handleModelsCommand);

  return { handleModelsCommand };
}

export default { DEFAULT_MODELS_COMMAND_TOOL, parseModelsCommandArgs, registerModelsCommand };
