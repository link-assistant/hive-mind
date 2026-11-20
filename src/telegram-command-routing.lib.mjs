/**
 * Route commands before both Telegraf's entity handlers and Hive Mind's text
 * fallback. Telegram can enumerate bot administrators and report joins/leaves,
 * but the Bot API has no complete roster of ordinary group members.
 * @see https://github.com/link-assistant/hive-mind/issues/4101
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTelegramCommandPrefix } from './telegram-command-text.lib.mjs';
import { isGroupChat } from './telegram-message-filters.lib.mjs';
import { TELEGRAM_PRIORITY_LOW, withTelegramRequestPriority } from './telegram-rate-limit.lib.mjs';

const MEMBERSHIP_TIMEOUT_MS = 1500;
export const TELEGRAM_ROUTING_UPDATES = Object.freeze(['message', 'callback_query', 'chat_member']);

function isBrandedBot(user) {
  return user?.is_bot && (/hive[ _-]*mind|swarm[ _-]*mind/i.test(user.username ?? '') || /(?:^|[^\p{L}\p{N}])(?:hive[ _-]*mind|swarm[ _-]*mind)(?:[ _-]*bot)?(?:$|[^\p{L}\p{N}])/iu.test(user.first_name ?? ''));
}

function isMember(member) {
  return member.status === 'member' || member.status === 'administrator' || member.status === 'creator' || (member.status === 'restricted' && member.is_member);
}

function samePeers(previous, current) {
  return current.size === (previous?.size ?? 0) && [...current].every(id => previous?.has(id));
}

async function loadKnownPeers(file, log) {
  try {
    const chats = JSON.parse(await readFile(file, 'utf8'));
    return new Map(chats.map(([chatId, ids]) => [chatId, new Set(ids)]));
  } catch (error) {
    if (error.code !== 'ENOENT') log(`Could not read peer IDs (${error.code || error.name})`);
    return new Map();
  }
}

/** Known peers are scoped to the chat and to the bot receiving the update. */
export function installTelegramCommandRouting(bot, { stateDir, configuredPeers = [], verbose = false }) {
  const log = message => {
    if (verbose) console.log(`[VERBOSE] Telegram command routing: ${message}`);
  };
  const configuredByChat = new Map();
  for (const { source: chatId, target: botId } of configuredPeers) {
    if (!configuredByChat.has(chatId)) configuredByChat.set(chatId, new Set());
    configuredByChat.get(chatId).add(botId);
  }

  let knownPeers;
  let stateFile;
  let loading;
  let writeTail = Promise.resolve();
  const checks = new Map();

  function setKnownPeers(chatId, ids) {
    if (ids.size) knownPeers.set(chatId, ids);
    else knownPeers.delete(chatId);
    if (!stateFile) return;
    // Telegraf confirms updates after middleware returns. Queue atomic
    // snapshots in membership order and await each change before confirming it.
    const snapshot = JSON.stringify([...knownPeers].map(([id, peers]) => [id, [...peers]]));
    writeTail = writeTail
      .then(async () => {
        await mkdir(stateDir, { recursive: true, mode: 0o700 });
        const temporary = `${stateFile}.${process.pid}.tmp`;
        await writeFile(temporary, snapshot, { mode: 0o600 });
        await rename(temporary, stateFile);
      })
      .catch(error => log(`Could not save peer IDs (${error.code || error.name})`));
    return writeTail;
  }

  function observePeers(ctx, chatId, selfId, authors) {
    const { message, update } = ctx;
    const fromChat = message?.migrate_from_chat_id ?? (message?.migrate_to_chat_id ? chatId : null);
    const toChat = message?.migrate_to_chat_id ?? chatId;
    const previous = knownPeers.get(toChat);
    const ids = new Set(previous);
    if (fromChat) {
      for (const id of knownPeers.get(fromChat) ?? []) ids.add(id);
      for (const id of configuredByChat.get(fromChat) ?? []) ids.add(id);
    }

    const member = update?.chat_member?.new_chat_member;
    const departed = message?.left_chat_member ?? (member && !isMember(member) ? member.user : null);
    for (const author of authors) ids.add(author.id);
    for (const user of message?.new_chat_members ?? (member && isMember(member) ? [member.user] : [])) {
      if (user.id !== selfId && isBrandedBot(user)) ids.add(user.id);
    }
    if (departed) ids.delete(departed.id);
    if (!samePeers(previous, ids)) return setKnownPeers(toChat, ids);
  }

  function requiresAddress(ctx, chatId, selfId) {
    const known = knownPeers.get(chatId);
    const inFlight = checks.get(chatId);
    if (inFlight && inFlight.known === known) return inFlight.result;

    const peerIds = new Set([...(known ?? []), ...(configuredByChat.get(chatId) ?? [])]);
    peerIds.delete(selfId);
    const ids = [...peerIds];
    const signal = AbortSignal.timeout(MEMBERSHIP_TIMEOUT_MS);
    // Low priority keeps the rate governor from waiting/retrying on the polling
    // path. Telegraf accepts the abort signal via callApi's third argument.
    const lookup = async (method, payload) => withTelegramRequestPriority(TELEGRAM_PRIORITY_LOW, () => ctx.telegram.callApi(method, { chat_id: chatId, ...payload }, { signal }));
    const result = Promise.allSettled([lookup('getChatAdministrators', { return_bots: true }), ...ids.map(id => lookup('getChatMember', { user_id: id }))])
      .then(async ([admins, ...members]) => {
        if (known !== knownPeers.get(chatId)) return true; // Membership changed while the lookup was in flight.
        const adminList = admins.status === 'fulfilled' && Array.isArray(admins.value) ? admins.value : null;
        const peerAdmins = adminList?.filter(({ user }) => user?.id !== selfId && isBrandedBot(user)) ?? [];
        const next = new Set(known);
        let peerPresent = peerAdmins.length > 0;
        let uncertain = !adminList;
        for (const [index, id] of ids.entries()) {
          const member = members[index].status === 'fulfilled' ? members[index].value : null;
          if (member?.user?.id !== id) uncertain = true;
          else if (member.status === 'left' || member.status === 'kicked' || (member.status === 'restricted' && !member.is_member)) next.delete(id);
          else if (member.user.is_bot && isMember(member)) peerPresent = true;
        }
        for (const { user } of peerAdmins) next.add(user.id);
        if (!samePeers(known, next)) {
          await setKnownPeers(chatId, next);
          if (knownPeers.get(chatId) !== (next.size ? next : undefined)) return true;
        }
        if (peerPresent) return true;
        // A failed read is not evidence that this bot is alone.
        if (uncertain) log(`Could not verify membership in chat ${chatId}`);
        return uncertain;
      })
      .finally(() => {
        if (checks.get(chatId)?.result === result) checks.delete(chatId);
      });
    checks.set(chatId, { known, result });
    return result;
  }

  bot.use(async (ctx, next) => {
    const message = ctx.message;
    const text = message?.text;
    const entity = message?.entities?.[0];
    const hasCommandEntity = typeof text === 'string' && entity?.type === 'bot_command' && entity.offset === 0;
    const prefix = parseTelegramCommandPrefix(text);
    const entityMention = hasCommandEntity ? parseTelegramCommandPrefix(text.slice(0, entity.length))?.botMention : null;
    const mention = entityMention ?? prefix?.botMention;
    if (mention) return mention.toLowerCase() === ctx.me?.toLowerCase() ? next() : undefined;
    if (!isGroupChat(ctx)) return next();
    const selfId = ctx.botInfo?.id;
    const authors = [message?.from, message?.reply_to_message?.from].filter(user => user?.id !== selfId && isBrandedBot(user));
    const membershipUpdate = message?.new_chat_members || message?.left_chat_member || message?.migrate_from_chat_id || message?.migrate_to_chat_id || ctx.update?.chat_member;
    if (!membershipUpdate && !authors.length && !prefix && !hasCommandEntity) return next();

    const chatId = ctx.chat.id;
    if (!knownPeers) {
      if (stateDir && Number.isSafeInteger(selfId)) {
        stateFile ??= join(stateDir, `telegram-peers-${selfId}.json`);
        loading ??= loadKnownPeers(stateFile, log).then(peers => (knownPeers = peers));
        await loading;
      } else {
        knownPeers = new Map();
      }
    }
    if (membershipUpdate || authors.length) await observePeers(ctx, chatId, selfId, authors);
    if ((prefix || hasCommandEntity) && (await requiresAddress(ctx, chatId, selfId))) return;
    return next();
  });
}
