import { setTimeout as delay } from 'node:timers/promises';
import { parseTelegramCommandPrefix } from './telegram-command-text.lib.mjs';
import { isForwarded } from './telegram-message-filters.lib.mjs';
import { TELEGRAM_PRIORITY_LOW, withTelegramRequestPriority } from './telegram-rate-limit.lib.mjs';

const VERSION = /^(?:v)?\d+\.\d+\.\d+(?:[.+-][a-z0-9]+(?:[.+-][a-z0-9]+)*)?$/i;
const IDENTITY = 'Hive Mind Telegram bot';
const LEGACY_VERSION = /(?:^|\n)\*?🤖 Hive-Mind\*?\n• (?:Version|Версия|संस्करण|版本): (`?)([^\n`]+)\1(?:\n|$)/u;
// Early releases displayed the same package version for the bot and both CLIs.
const LEGACY_BOT_VERSION = /^🤖 Version Information\n\nBot: ([^\n]+)\nsolve: \1\nhive: \1(?:\n|$)/u;
const LEGACY_COMPONENTS_VERSION = /^🤖 Version Information\n\n🤖 Bot Components\n• Bot: ([^\n]+)\n• solve: \1\n• hive: \1(?:\n|$)/u;
const USERNAME = /^[a-z\d_]{5,32}$/i;
const RESPONSE_WINDOW_MS = 90_000; // Legacy /version reports can be edited in after CLI probes.
const PROBE_RETRY_MS = 10 * 60_000;
const MAX_PROBES_PER_CHAT = 12;
const MAX_RECENT_CANDIDATES = 128;

function identityCommand(text) {
  const prefix = parseTelegramCommandPrefix(text);
  if (prefix && prefix.length === text.length && (prefix.command === 'who' || prefix.command === 'version')) return prefix;
}

function readVersion(text, command) {
  if (typeof text !== 'string') return;
  let version;
  if (text.startsWith(`${IDENTITY} v`)) version = text.slice(IDENTITY.length + 2);
  else if (command === 'version') version = LEGACY_VERSION.exec(text)?.[2] ?? LEGACY_BOT_VERSION.exec(text)?.[1] ?? LEGACY_COMPONENTS_VERSION.exec(text)?.[1];
  if (VERSION.test(version ?? '')) return version;
}

/** Identity messages use normal group updates and reply threading, independently of command dispatch. */
export function createTelegramPeerDiscovery(telegram, { getVersion, log, startedAt, jitterMs = 500, whoWaitMs = 1_500, versionWaitMs = 1_000 }) {
  const chats = new Map();
  const identities = new Map();

  function chatState(chatId) {
    if (!chats.has(chatId)) {
      if (chats.size >= 256) chats.delete(chats.keys().next().value);
      chats.set(chatId, { probes: new Map(), replies: new Map(), broadcast: null });
    }
    return chats.get(chatId);
  }

  function fresh(message) {
    return message?.date >= startedAt && Date.now() - message.date * 1000 <= RESPONSE_WINDOW_MS && !message.sender_chat && !isForwarded({ message });
  }

  async function send(ctx, text, extra = {}) {
    const threadId = ctx.message?.is_topic_message ? ctx.message.message_thread_id : undefined;
    try {
      return await withTelegramRequestPriority(TELEGRAM_PRIORITY_LOW, () => telegram.callApi('sendMessage', { chat_id: ctx.chat.id, text, message_thread_id: threadId, ...extra }, { signal: AbortSignal.timeout(1_500) }));
    } catch (error) {
      log(`Could not send peer discovery message in chat ${ctx.chat.id} (${error.code || error.name})`);
    }
  }

  async function reply(ctx) {
    const message = ctx.message;
    if (!fresh(message) || message.from?.id === ctx.botInfo?.id) return;
    const from = message.from;
    if (from?.is_bot) {
      const { replies } = chatState(ctx.chat.id);
      const now = Date.now();
      for (const [id, previous] of replies) if (now - previous.at > 60_000) replies.delete(id);
      const previous = replies.get(from.id);
      if (previous?.id >= message.message_id || now - previous?.at < 750 || (!previous && replies.size >= MAX_PROBES_PER_CHAT)) return;
      replies.set(from.id, { id: message.message_id, at: now });
    }
    const version = (await getVersion()).replace(/^v/i, '');
    await send(ctx, `${IDENTITY} ${VERSION.test(version) ? `v${version}` : 'version unknown'}`, { reply_parameters: { message_id: message.message_id }, disable_notification: Boolean(from?.is_bot) });
  }

  function startProbe(ctx, user, isKnown) {
    const probe = { at: Date.now(), sent: new Map(), pending: null, cancelled: false };
    const ask = async command => {
      const text = user ? `/${command}@${user.username}` : `/${command}`;
      probe.sent.set(text, null);
      log(`Checking ${user ? `@${user.username}` : 'for peers'} with /${command} in chat ${ctx.chat.id}`);
      const sent = await send(ctx, text, { disable_notification: true });
      if (sent) probe.sent.set(text, sent.message_id);
      else probe.sent.delete(text);
    };
    probe.pending = (async () => {
      await delay(Math.floor(jitterMs / 4 + Math.random() * jitterMs));
      if (probe.cancelled || (user && isKnown(user.id))) return;
      await ask('who');
      if (probe.sent.size) await delay(whoWaitMs);
      if (!probe.cancelled && user && !isKnown(user.id) && probe.sent.size) {
        await ask('version');
        await delay(versionWaitMs);
      }
    })().finally(() => (probe.pending = null));
    return probe;
  }

  function observeCandidates(ctx, users, isKnown) {
    if (!users.length || !fresh(ctx.message ?? ctx.update.chat_member ?? ctx.update.my_chat_member)) return;
    const { probes } = chatState(ctx.chat.id);
    const now = Date.now();
    for (const [id, probe] of probes) if (!probe.pending && now - probe.at >= PROBE_RETRY_MS) probes.delete(id);
    let pendingCount = [...probes.values()].filter(probe => probe.pending).length;
    for (const user of users) {
      if (pendingCount >= MAX_PROBES_PER_CHAT || probes.size >= MAX_RECENT_CANDIDATES) break;
      if (user?.is_bot && user.id !== ctx.botInfo?.id && USERNAME.test(user.username ?? '') && !isKnown(user.id) && !probes.has(user.id)) {
        probes.set(user.id, startProbe(ctx, user, isKnown));
        pendingCount++;
      }
    }
  }

  function waitForDiscovery(ctx, isKnown, broadcast) {
    if (!fresh(ctx.message ?? ctx.update.my_chat_member)) return;
    const chatId = ctx.chat.id;
    const state = chatState(chatId);
    const stillInChat = () => chats.get(chatId) === state;
    const pending = [...state.probes.values()].map(probe => probe.pending).filter(Boolean);
    if (state.broadcast?.pending) pending.push(state.broadcast.pending);
    if (pending.length) return Promise.all(pending).then(stillInChat);
    if (!broadcast) return;
    if (state.broadcast && Date.now() - state.broadcast.at < PROBE_RETRY_MS) return;
    state.broadcast = startProbe(ctx, null, isKnown);
    return state.broadcast.pending.then(stillInChat);
  }

  function identifyReply(ctx) {
    const message = ctx.update.edited_message ?? ctx.message;
    const request = message?.reply_to_message;
    const user = message?.from;
    if (!user?.is_bot || user.id === ctx.botInfo?.id || !request?.from || user.id === request.from.id || !fresh(message) || !fresh(request)) return;
    const command = identityCommand(request.text);
    if (!command || (command.botMention && command.botMention.toLowerCase() !== user.username?.toLowerCase())) return;
    const version = readVersion(message.text, command.command);
    if (!version) return;
    if (request.from.id === ctx.botInfo?.id) {
      const state = chats.get(ctx.chat.id);
      const probe = command.botMention ? state?.probes.get(user.id) : state?.broadcast;
      const sentId = probe?.sent.get(request.text);
      if (sentId === undefined || (sentId !== null && sentId !== request.message_id) || Date.now() - probe.at > RESPONSE_WINDOW_MS) return;
    }
    if (identities.size >= 1024 && !identities.has(user.id)) identities.delete(identities.keys().next().value);
    identities.set(user.id, { username: user.username, version });
    log(`Confirmed bot ${user.id} (@${user.username}) as Hive Mind ${version} from /${command.command} in chat ${ctx.chat.id}`);
    return user;
  }

  function resetProbes(chatId, userId) {
    const state = chats.get(chatId);
    if (!state) return;
    if (userId !== undefined) {
      const probe = state.probes.get(userId);
      if (probe) probe.cancelled = true;
      state.probes.delete(userId);
      return;
    }
    for (const probe of state.probes.values()) probe.cancelled = true;
    if (state.broadcast) state.broadcast.cancelled = true;
    chats.delete(chatId);
  }

  return { identifyReply, identityCommand, observeCandidates, reply, resetProbes, waitForDiscovery, isIdentified: user => identities.has(user.id) };
}
