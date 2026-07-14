/**
 * In-process Telegram Bot API rate-limit telemetry.
 *
 * Telegram does not expose a quota endpoint. The Bot API documents approximate
 * outbound-message limits and reports actual flood control as error 429 with a
 * ResponseParameters.retry_after value. This tracker therefore combines local
 * rolling counters with the last observed server-side throttle.
 */

export const TELEGRAM_RATE_LIMITS = Object.freeze({
  GLOBAL_MESSAGES_PER_SECOND: 30,
  GROUP_MESSAGES_PER_MINUTE: 20,
});

const TRACKER_INSTALLED = Symbol.for('hiveMind.telegramRateLimitTrackerInstalled');

function isMessageMethod(method) {
  const name = String(method || '');
  if (/^sendChatAction$/i.test(name)) return false;
  return /^(send|copyMessage$|forwardMessage$|editMessage)/i.test(name);
}

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

export class TelegramRateLimitTracker {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.messageEvents = [];
    this.totalApiRequests = 0;
    this.rateLimitResponses = 0;
    this.lastRateLimit = null;
  }

  prune(now = this.now()) {
    const oldestRelevant = now - 60_000;
    this.messageEvents = this.messageEvents.filter(event => event.at > oldestRelevant);
  }

  recordRequest(method, payload = {}) {
    this.totalApiRequests++;
    if (!isMessageMethod(method)) return;

    const now = this.now();
    const chatId = toChatId(payload);
    this.messageEvents.push({ at: now, method: String(method), chatId, isGroup: isGroupChatId(chatId) });
    this.prune(now);
  }

  recordError(error, method, payload = {}) {
    const rateLimit = extractRateLimitError(error);
    if (!rateLimit) return false;

    const observedAt = this.now();
    this.rateLimitResponses++;
    this.lastRateLimit = {
      ...rateLimit,
      method: String(method || 'unknown'),
      chatId: toChatId(payload),
      observedAt,
      retryUntil: rateLimit.retryAfterSeconds === null ? null : observedAt + rateLimit.retryAfterSeconds * 1_000,
    };
    return true;
  }

  getSnapshot() {
    const now = this.now();
    this.prune(now);

    const globalUsed = this.messageEvents.filter(event => event.at > now - 1_000).length;
    const groupCounts = new Map();
    for (const event of this.messageEvents) {
      if (!event.isGroup || event.chatId === null) continue;
      groupCounts.set(event.chatId, (groupCounts.get(event.chatId) || 0) + 1);
    }
    let busiestGroupChatId = null;
    let busiestGroupUsed = 0;
    for (const [chatId, count] of groupCounts) {
      if (count > busiestGroupUsed) {
        busiestGroupChatId = chatId;
        busiestGroupUsed = count;
      }
    }

    let lastRateLimit = null;
    if (this.lastRateLimit) {
      const retryRemainingSeconds = this.lastRateLimit.retryUntil === null ? null : Math.max(0, Math.ceil((this.lastRateLimit.retryUntil - now) / 1_000));
      lastRateLimit = { ...this.lastRateLimit, retryRemainingSeconds };
    }

    return {
      global: {
        used: globalUsed,
        limit: TELEGRAM_RATE_LIMITS.GLOBAL_MESSAGES_PER_SECOND,
        usedPercentage: percentage(globalUsed, TELEGRAM_RATE_LIMITS.GLOBAL_MESSAGES_PER_SECOND),
      },
      busiestGroup: {
        used: busiestGroupUsed,
        limit: TELEGRAM_RATE_LIMITS.GROUP_MESSAGES_PER_MINUTE,
        usedPercentage: percentage(busiestGroupUsed, TELEGRAM_RATE_LIMITS.GROUP_MESSAGES_PER_MINUTE),
        chatId: busiestGroupChatId,
      },
      totalApiRequests: this.totalApiRequests,
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

export function installTelegramRateLimitTracker(telegram, { tracker = defaultTracker, verbose = false } = {}) {
  if (!telegram || telegram[TRACKER_INSTALLED]) return telegram;
  const originalCallApi = telegram.callApi;
  if (typeof originalCallApi !== 'function') return telegram;

  telegram.callApi = async function trackedCallApi(method, payload = {}, ...rest) {
    tracker.recordRequest(method, payload);
    if (verbose && isMessageMethod(method)) {
      const snapshot = tracker.getSnapshot();
      console.log(`[VERBOSE] Telegram Bot API ${method}: global ${snapshot.global.used}/${snapshot.global.limit} messages/1s; busiest group ${snapshot.busiestGroup.used}/${snapshot.busiestGroup.limit} messages/1m`);
    }
    try {
      return await originalCallApi.call(this, method, payload, ...rest);
    } catch (error) {
      if (tracker.recordError(error, method, payload)) {
        const observed = tracker.getSnapshot().lastRateLimit;
        console.warn(`[telegram-bot] Telegram Bot API rate limit: method=${observed.method} chat=${observed.chatId ?? 'unknown'} retry_after=${observed.retryAfterSeconds ?? 'unknown'}s`);
        if (verbose) console.error('[VERBOSE] Telegram Bot API 429 response:', JSON.stringify(error?.response || { message: error?.message }, null, 2));
      }
      throw error;
    }
  };

  telegram[TRACKER_INSTALLED] = true;
  return telegram;
}
