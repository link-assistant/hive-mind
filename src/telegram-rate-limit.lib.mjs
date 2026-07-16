/**
 * Telegram Bot API rate-limit telemetry for `/limits` (issues #2060 and #2070).
 *
 * Telegram exposes no quota endpoint, and the official open-source Bot API
 * server does not even implement the sending limits: `Client::get_retry_after_time`
 * only parses `"Too Many Requests: retry after "` out of errors relayed from
 * Telegram's closed backend. The published numbers are hedged ("about 30",
 * "~30 users per second", "we may allow short bursts that go over this limit"),
 * and Telegram tells bot authors to write clients that do not "depend on
 * hardcoded limit values".
 *
 * This module therefore does not pretend to mirror a server counter. It keeps
 * rolling windows modelled on the documented limits and then corrects each
 * window's limit from what Telegram actually does: a successful call proves the
 * window it landed in is allowed, and a 429 proves the window it landed in is
 * not. The documented values are only a starting point.
 *
 * References:
 * - https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
 * - https://core.telegram.org/bots/api#responseparameters
 * - https://core.telegram.org/bots/features#dedicated-test-environment
 * - https://github.com/tdlib/telegram-bot-api/blob/master/telegram-bot-api/Client.cpp
 * - https://github.com/tdlib/td/issues/3034 (message edits share the sending limits)
 * - https://grammy.dev/advanced/flood
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

/**
 * The windows Telegram is believed to enforce, with the evidence for each size.
 *
 * `chat` restates the documented "avoid sending more than one message per
 * second" advisory as a sustained rate over a minute, because the same FAQ
 * allows short bursts above it. grammY models that advisory the same way, as a
 * sustained rate rather than a hard per-second cap.
 *
 * `other` has no documented size: Telegram states no limit for `getUpdates`,
 * `getMe` or `answerCallbackQuery`, yet grammY lists "getUpdates cannot receive
 * flood wait errors" among the false assumptions. It stays unknown, and hidden,
 * until a 429 measures it.
 */
export const TELEGRAM_LIMIT_RULES = Object.freeze([Object.freeze({ id: 'chat', kind: 'message', scope: 'chat', windowMs: MINUTE_MS, documentedLimit: 60 }), Object.freeze({ id: 'group', kind: 'message', scope: 'group', windowMs: MINUTE_MS, documentedLimit: 20 }), Object.freeze({ id: 'broadcast', kind: 'message', scope: 'global', windowMs: SECOND_MS, documentedLimit: 30 }), Object.freeze({ id: 'other', kind: 'other', scope: 'global', windowMs: SECOND_MS, documentedLimit: null })]);

/** A window must be at least this full before a 429 can be blamed on it. */
const BLAME_UTILIZATION = 0.5;

const TRACKER_INSTALLED = Symbol.for('hiveMind.telegramRateLimitTrackerInstalled');
const MAX_WINDOW_MS = Math.max(...TELEGRAM_LIMIT_RULES.map(rule => rule.windowMs));

/**
 * Chat-scoped methods that read or signal instead of producing a message.
 * telegraf-throttler excludes exactly these from the per-group sending limit.
 * https://github.com/KnightNiwrem/telegraf-throttler
 */
const NON_MESSAGE_CHAT_METHODS = new Set(['sendchataction', 'getchat', 'getchatadministrators', 'getchatmember', 'getchatmembercount', 'getchatmemberscount']);

function toChatId(payload) {
  const value = payload?.chat_id;
  return value === null || value === undefined ? null : String(value);
}

function isGroupChatId(chatId) {
  return typeof chatId === 'string' && chatId.startsWith('-');
}

function percentage(used, limit) {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

/**
 * Decide which limits a request is subject to.
 *
 * grammY, python-telegram-bot and telegraf-throttler all key on the presence of
 * `chat_id` rather than on a method allow-list, because that parameter is what
 * scopes a call to a conversation. Doing the same keeps message edits inside the
 * sending limits, which TDLib's maintainer confirms they share.
 */
export function classifyTelegramRequest(method, payload = {}) {
  const name = String(method || '');
  const chatId = toChatId(payload);
  const kind = chatId !== null && !NON_MESSAGE_CHAT_METHODS.has(name.toLowerCase()) ? 'message' : 'other';
  return { method: name, chatId, kind, isGroup: isGroupChatId(chatId) };
}

function ruleMatches(rule, event) {
  if (rule.kind !== event.kind) return false;
  if (rule.scope === 'group') return event.isGroup;
  if (rule.scope === 'chat') return event.chatId !== null;
  return true;
}

function ruleKey(rule, event) {
  return rule.scope === 'global' ? '' : event.chatId;
}

function extractRateLimitError(error) {
  const response = error?.response || error;
  const code = response?.error_code ?? response?.status ?? error?.code;
  const description = response?.description || error?.description || error?.message || '';
  if (Number(code) !== 429 && !/\b429\b|too many requests/i.test(String(description))) return null;

  const rawRetryAfter = response?.parameters?.retry_after ?? error?.parameters?.retry_after;
  const retryAfterSeconds = Number(rawRetryAfter);
  return {
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds : null,
    description: String(description),
  };
}

/** Order candidates so the window closest to refusing the next request wins. */
function isMoreConstrained(candidate, best) {
  if (candidate.throttled !== best.throttled) return candidate.throttled;
  if (candidate.remaining !== best.remaining) return candidate.remaining < best.remaining;
  if (candidate.used !== best.used) return candidate.used > best.used;
  return candidate.usedPercentage > best.usedPercentage;
}

function mostUtilized(candidates) {
  return candidates.reduce((best, candidate) => (candidate.utilization > best.utilization ? candidate : best));
}

export class TelegramRateLimitTracker {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.events = [];
    this.totalApiRequests = 0;
    this.messageRequests = 0;
    this.rateLimitResponses = 0;
    this.lastRateLimit = null;
    this.rules = new Map(
      TELEGRAM_LIMIT_RULES.map(rule => [
        rule.id,
        {
          rule,
          limit: rule.documentedLimit,
          limitSource: rule.documentedLimit === null ? 'unknown' : 'documented',
          peak: 0,
          throttledUntil: null,
        },
      ])
    );
  }

  prune(now = this.now()) {
    const oldestRelevant = now - MAX_WINDOW_MS;
    this.events = this.events.filter(event => event.at > oldestRelevant);
  }

  /** Count matching requests inside one rule's window, split by chat when scoped. */
  windowCounts(rule, now) {
    const oldestRelevant = now - rule.windowMs;
    const counts = new Map();
    for (const event of this.events) {
      if (event.at <= oldestRelevant || !ruleMatches(rule, event)) continue;
      const key = ruleKey(rule, event);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  /**
   * Record an outbound request and return the window counts it lands in, so the
   * eventual response can be attributed to those exact windows.
   */
  recordRequest(method, payload = {}) {
    const at = this.now();
    const event = { at, ...classifyTelegramRequest(method, payload) };
    this.totalApiRequests++;
    if (event.kind === 'message') this.messageRequests++;
    this.events.push(event);
    this.prune(at);

    const counts = new Map();
    for (const rule of TELEGRAM_LIMIT_RULES) {
      if (!ruleMatches(rule, event)) continue;
      counts.set(rule.id, this.windowCounts(rule, at).get(ruleKey(rule, event)) || 0);
    }
    return { event, counts };
  }

  /** Telegram accepted the request, so every window it landed in tolerates its count. */
  recordSuccess(pending) {
    if (!pending?.counts) return;
    for (const [id, count] of pending.counts) {
      const state = this.rules.get(id);
      if (count > state.peak) state.peak = count;
      // An unknown limit stays unknown: a success proves capacity, never a ceiling.
      if (state.limit !== null && count > state.limit) {
        state.limit = count;
        state.limitSource = 'observed';
      }
    }
  }

  /**
   * Pick the window that best explains a 429, or none when no modelled window
   * was full enough to be a plausible cause.
   */
  blameRule(pending) {
    if (!pending?.counts?.size) return null;
    const candidates = [];
    for (const [id, count] of pending.counts) {
      const state = this.rules.get(id);
      const utilization = state.limit === null ? Infinity : count / state.limit;
      candidates.push({ state, count, utilization, explained: state.limit !== null && count >= state.limit });
    }

    const explained = candidates.filter(candidate => candidate.explained);
    if (explained.length) return mostUtilized(explained);
    // A 429 that arrives while every window is nearly empty was caused by state
    // we cannot observe: flood control carries a penalty across windows and
    // escalates on repeat offences. Blaming a window would collapse its limit
    // for no reason, so learn nothing and only report the throttle.
    const plausible = candidates.filter(candidate => candidate.count >= 2 && candidate.utilization >= BLAME_UTILIZATION);
    return plausible.length ? mostUtilized(plausible) : null;
  }

  recordError(error, pending = null) {
    const details = extractRateLimitError(error);
    if (!details) return null;

    const at = this.now();
    this.rateLimitResponses++;
    const retryUntil = details.retryAfterSeconds === null ? null : at + details.retryAfterSeconds * SECOND_MS;
    const blamed = this.blameRule(pending);
    // Blame is decided from the count including this request, but the request
    // itself was refused: it never landed in any window. Dropping it keeps the
    // windows a record of what Telegram accepted, so `used` cannot exceed the
    // ceiling the refusal just proved.
    const landed = this.events.indexOf(pending?.event);
    if (landed !== -1) this.events.splice(landed, 1);
    if (blamed && !blamed.explained) {
      // Telegram refused a window our estimate still considered allowed, so the
      // estimate is too high: the real limit is below the refused count.
      blamed.state.limit = Math.max(1, blamed.count - 1);
      blamed.state.limitSource = 'observed';
    }
    if (blamed) blamed.state.throttledUntil = retryUntil;

    this.lastRateLimit = {
      method: pending?.event?.method || 'unknown',
      chatId: pending?.event?.chatId ?? null,
      retryAfterSeconds: details.retryAfterSeconds,
      description: details.description,
      observedAt: at,
      retryUntil,
      ruleId: blamed?.state.rule.id ?? null,
    };
    return this.lastRateLimit;
  }

  describeRule(rule, now) {
    const state = this.rules.get(rule.id);
    if (state.limit === null) return null;

    let busiest = null;
    for (const [key, count] of this.windowCounts(rule, now)) {
      if (!busiest || count > busiest.count) busiest = { key, count };
    }
    // A per-chat window with no traffic has no subject, so showing it would add
    // a phantom bar for a conversation the bot is not talking to.
    if (!busiest) {
      if (rule.scope !== 'global') return null;
      busiest = { key: '', count: 0 };
    }

    return {
      id: rule.id,
      scope: rule.scope,
      windowMs: rule.windowMs,
      chatId: rule.scope === 'global' ? null : busiest.key,
      used: busiest.count,
      limit: state.limit,
      limitSource: state.limitSource,
      peak: state.peak,
      remaining: Math.max(0, state.limit - busiest.count),
      usedPercentage: percentage(busiest.count, state.limit),
      throttled: state.throttledUntil !== null && state.throttledUntil > now,
    };
  }

  describeLastRateLimit(now) {
    if (!this.lastRateLimit) return null;
    const { retryUntil } = this.lastRateLimit;
    const retryRemainingSeconds = retryUntil === null ? null : Math.max(0, Math.ceil((retryUntil - now) / SECOND_MS));
    return { ...this.lastRateLimit, retryRemainingSeconds };
  }

  getSnapshot() {
    const now = this.now();
    this.prune(now);

    const rules = TELEGRAM_LIMIT_RULES.map(rule => this.describeRule(rule, now)).filter(Boolean);
    let display = null;
    for (const candidate of rules) {
      if (!display || isMoreConstrained(candidate, display)) display = candidate;
    }

    const lastRateLimit = this.describeLastRateLimit(now);
    return {
      display,
      rules,
      throttled: Boolean(lastRateLimit?.retryRemainingSeconds),
      totalApiRequests: this.totalApiRequests,
      messageRequests: this.messageRequests,
      rateLimitResponses: this.rateLimitResponses,
      lastRateLimit,
    };
  }
}

const defaultTracker = new TelegramRateLimitTracker();

export function getTelegramRateLimits(verbose = false) {
  const telegramRateLimit = defaultTracker.getSnapshot();
  if (verbose) console.log('[VERBOSE] /limits Telegram Bot API telemetry:', JSON.stringify(telegramRateLimit, null, 2));
  return { success: true, telegramRateLimit };
}

/**
 * Observe every Bot API call from Telegraf's single `callApi` choke point, which
 * also carries `getUpdates` long polling, without delaying, retrying, reordering
 * or swallowing anything.
 */
export function installTelegramRateLimitTracker(telegram, { tracker = defaultTracker, verbose = false } = {}) {
  if (!telegram || telegram[TRACKER_INSTALLED]) return telegram;
  const originalCallApi = telegram.callApi;
  if (typeof originalCallApi !== 'function') return telegram;

  telegram.callApi = async function trackedCallApi(method, payload = {}, ...rest) {
    const pending = tracker.recordRequest(method, payload);
    try {
      const result = await originalCallApi.call(this, method, payload, ...rest);
      tracker.recordSuccess(pending);
      if (verbose) console.log(`[VERBOSE] Telegram Bot API ${method} accepted; windows: ${JSON.stringify(Object.fromEntries(pending.counts))}`);
      return result;
    } catch (error) {
      const observed = tracker.recordError(error, pending);
      if (observed) {
        console.warn(`[telegram-bot] Telegram Bot API rate limit: method=${observed.method} chat=${observed.chatId ?? 'unknown'} retry_after=${observed.retryAfterSeconds ?? 'unknown'}s window=${observed.ruleId ?? 'unattributed'}`);
        if (verbose) console.error('[VERBOSE] Telegram Bot API 429 response:', JSON.stringify(error?.response || { message: error?.message }, null, 2));
      }
      throw error;
    }
  };

  telegram[TRACKER_INSTALLED] = true;
  return telegram;
}
