/**
 * Route commands before both Telegraf's entity handlers and Hive Mind's text
 * fallback. Telegram can enumerate bot administrators and report joins/leaves,
 * but the Bot API has no complete roster of ordinary group members.
 * @see https://github.com/link-assistant/hive-mind/issues/4101
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInBackground } from './telegram-background-task.lib.mjs';
import { parseTelegramCommandPrefix } from './telegram-command-text.lib.mjs';
import { isGroupChat } from './telegram-message-filters.lib.mjs';
import { createTelegramPeerDiscovery } from './telegram-peer-discovery.lib.mjs';
import { TELEGRAM_PRIORITY_LOW, withTelegramRequestPriority } from './telegram-rate-limit.lib.mjs';

const MEMBERSHIP_TIMEOUT_MS = 1500;
export const TELEGRAM_ROUTING_UPDATES = Object.freeze(['message', 'edited_message', 'callback_query', 'chat_member', 'my_chat_member']);

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
export function installTelegramCommandRouting(bot, { stateDir, configuredPeers = [], verbose = false, identity, onError }) {
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
  const discovery = identity && createTelegramPeerDiscovery(bot.telegram, { ...identity, log });
  const isPeer = user => isBrandedBot(user) || (user?.is_bot && discovery?.isIdentified(user));
  const isKnown = (chatId, id) => knownPeers.get(chatId)?.has(id) || configuredByChat.get(chatId)?.has(id);

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

  function observePeers(ctx, chatId, selfId, authors, joined, departed) {
    const { message } = ctx;
    const fromChat = message?.migrate_from_chat_id ?? (message?.migrate_to_chat_id ? chatId : null);
    const toChat = message?.migrate_to_chat_id ?? chatId;
    const previous = knownPeers.get(toChat);
    const ids = new Set(previous);
    if (fromChat) {
      for (const id of knownPeers.get(fromChat) ?? []) ids.add(id);
      for (const id of configuredByChat.get(fromChat) ?? []) ids.add(id);
    }

    for (const author of authors) ids.add(author.id);
    for (const user of joined) {
      if (user.id !== selfId && isPeer(user)) ids.add(user.id);
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
    const result = Promise.allSettled([lookup('getChatAdministrators', { return_bots: true }), discovery && !ids.length ? lookup('getChatMemberCount') : null, ...ids.map(id => lookup('getChatMember', { user_id: id }))])
      .then(async ([admins, memberCount, ...members]) => {
        if (known !== knownPeers.get(chatId)) return 'addressed'; // Membership changed while the lookup was in flight.
        const adminList = admins.status === 'fulfilled' && Array.isArray(admins.value) ? admins.value : null;
        const otherAdmins = (adminList ?? []).map(({ user }) => user).filter(user => user?.is_bot && user.id !== selfId);
        const peerAdmins = otherAdmins.filter(isPeer);
        const next = new Set(known);
        let peerPresent = peerAdmins.length > 0;
        let uncertain = !adminList;
        for (const [index, id] of ids.entries()) {
          const member = members[index].status === 'fulfilled' ? members[index].value : null;
          if (member?.user?.id !== id) uncertain = true;
          else if (member.status === 'left' || member.status === 'kicked' || (member.status === 'restricted' && !member.is_member)) next.delete(id);
          else if (member.user.is_bot && isMember(member)) peerPresent = true;
        }
        for (const user of peerAdmins) next.add(user.id);
        if (!samePeers(known, next)) {
          await setKnownPeers(chatId, next);
          if (knownPeers.get(chatId) !== (next.size ? next : undefined)) return 'addressed';
        }
        discovery?.observeCandidates(ctx, otherAdmins, id => isKnown(chatId, id));
        if (peerPresent) return 'addressed';
        // A failed read is not evidence that this bot is alone.
        if (uncertain) log(`Could not verify membership in chat ${chatId}`);
        if (uncertain) return 'addressed';
        const accountedFor = new Set([selfId, ...adminList.map(({ user }) => user?.id)].filter(Number.isSafeInteger)).size;
        return memberCount.value === accountedFor ? 'solo' : 'discover';
      })
      .finally(() => {
        if (checks.get(chatId)?.result === result) checks.delete(chatId);
      });
    checks.set(chatId, { known, result });
    return result;
  }

  bot.use(async (ctx, next) => {
    const message = ctx.message;
    const selfId = ctx.botInfo?.id;
    if (selfId !== undefined && message?.from?.id === selfId) return;
    const text = message?.text;
    const entity = message?.entities?.[0];
    const hasCommandEntity = typeof text === 'string' && entity?.type === 'bot_command' && entity.offset === 0;
    const prefix = parseTelegramCommandPrefix(text);
    const entityMention = hasCommandEntity ? parseTelegramCommandPrefix(text.slice(0, entity.length))?.botMention : null;
    const mention = entityMention ?? prefix?.botMention;
    const addressedElsewhere = mention && mention.toLowerCase() !== ctx.me?.toLowerCase();
    const command = discovery?.identityCommand(text)?.command;
    const humanWho = command === 'who' && !message.from?.is_bot;
    const dispatch = () => (humanWho ? discovery.reply(ctx) : next());
    if (!isGroupChat(ctx)) return addressedElsewhere ? undefined : dispatch();

    const member = ctx.update?.chat_member?.new_chat_member;
    const joined = message?.new_chat_members ?? (member && isMember(member) ? [member.user] : []);
    const departed = message?.left_chat_member ?? (member && !isMember(member) ? member.user : null);
    const myMembership = ctx.update?.my_chat_member;
    const membershipUpdate = joined.length || departed || message?.migrate_from_chat_id || message?.migrate_to_chat_id || myMembership;
    const visible = [message?.from, message?.reply_to_message?.from].filter(user => user?.is_bot && user.id !== selfId && user.id !== departed?.id);
    const authors = visible.filter(isPeer);
    const confirmed = discovery?.identifyReply(ctx);
    if (confirmed) authors.push(confirmed);
    const bareCommand = !mention && (prefix || hasCommandEntity);
    if (!membershipUpdate && !authors.length && !bareCommand && !(discovery && visible.length)) return addressedElsewhere ? undefined : dispatch();

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
    if (membershipUpdate || authors.length) await observePeers(ctx, chatId, selfId, authors, joined, departed);
    if (departed) discovery?.resetProbes(chatId, departed.id);
    const migratedFrom = message?.migrate_from_chat_id ?? (message?.migrate_to_chat_id ? chatId : null);
    if (migratedFrom) discovery?.resetProbes(migratedFrom);
    if (myMembership && !isMember(myMembership.new_chat_member)) discovery?.resetProbes(chatId);
    const knowsPeer = id => isKnown(chatId, id);
    discovery?.observeCandidates(ctx, [...joined, ...visible], knowsPeer);
    const selfJoined = joined.some(user => user.id === selfId) || (myMembership && !isMember(myMembership.old_chat_member) && isMember(myMembership.new_chat_member));
    if (discovery && selfJoined) {
      const membership = await requiresAddress(ctx, chatId, selfId);
      discovery.waitForDiscovery(ctx, knowsPeer, membership === 'discover');
    }

    if (addressedElsewhere) return;
    // A peer identity probe has its own small response and cannot reach the
    // human /version handler or the bare-command gate that it is discovering.
    if (command && message.from?.is_bot) return discovery.reply(ctx);
    if (!bareCommand) return dispatch();
    const membership = await requiresAddress(ctx, chatId, selfId);
    if (membership === 'addressed') return;
    const pending = discovery?.waitForDiscovery(ctx, knowsPeer, membership === 'discover');
    if (!pending) return dispatch();
    // A later Telegram polling batch can contain the identity reply. Holding
    // this update open would prevent Telegraf from reading that batch.
    void runInBackground(
      async () => {
        if (!(await pending) || knownPeers.get(chatId)?.size) return;
        // A reply or a new peer's probe can expose another candidate during
        // the first round. Give the live probes one bounded round to finish.
        const followUp = discovery.waitForDiscovery(ctx, knowsPeer, false);
        if (followUp && !(await followUp)) return;
        if (!knownPeers.get(chatId)?.size) await dispatch();
      },
      { label: 'Telegram command discovery', onError: onError && (error => onError(error, ctx)) }
    );
  });
}
