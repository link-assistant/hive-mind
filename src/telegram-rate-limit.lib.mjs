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
 * Issue #2571 turned the observer into a governor. Counting 429s is useless if
 * nothing reacts to them: a big queue kept editing ~20 waiting cards back to back
 * in one group every minute and collected 86 refusals in 20 minutes, each new
 * edit landing inside the `retry_after` Telegram had just announced. The
 * governor now, at the same `callApi` choke point:
 *
 * - holds every request to a chat until that chat's `retry_after` has elapsed;
 * - paces message requests so no modelled window goes over its learned limit;
 * - drops low-priority requests (periodic status edits, see
 *   `withTelegramRequestPriority`) instead of delaying them, and keeps a
 *   reserve of each window free for replies to people;
 * - retries a normal-priority request once after a 429 when the wait is short.
 *
 * References:
 * - https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
 * - https://core.telegram.org/bots/api#responseparameters
 * - https://core.telegram.org/bots/features#dedicated-test-environment
 * - https://github.com/tdlib/telegram-bot-api/blob/master/telegram-bot-api/Client.cpp
 * - https://github.com/tdlib/td/issues/3034 (message edits share the sending limits)
 * - https://grammy.dev/advanced/flood
 * - https://grammy.dev/plugins/auto-retry and https://grammy.dev/plugins/transformer-throttler
 * - https://docs.python-telegram-bot.org/en/stable/telegram.ext.aioratelimiter.html
 */

import { AsyncLocalStorage } from 'node:async_hooks';

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

/**
 * How long a refusal outranks contradicting successes (issue #2571).
 *
 * Telegram's window is not aligned with ours, so the same group was refused at
 * 20 requests in our window and accepted at 23 a few minutes later. Letting each
 * success raise the limit made the estimate climb straight back into the next
 * refusal ("observed limit 21, peak 23"). Within this horizon a refusal wins;
 * once it passes without another 429 a lowered limit returns to the documented
 * value and successes may raise it again.
 */
export const LIMIT_EVIDENCE_TTL_MS = 30 * MINUTE_MS;

/**
 * Share of every window that low-priority requests may not use, so a reply to a
 * person still fits when periodic status edits have used up their part.
 */
export const LOW_PRIORITY_RESERVE = 0.25;

/** Longest a normal-priority request waits for pacing or `retry_after` before failing locally. */
export const DEFAULT_MAX_WAIT_MS = 75 * SECOND_MS;

/** Normal-priority requests are retried this many times after a real 429. */
export const DEFAULT_MAX_RETRIES = 1;

/** Margin added to computed waits so the request lands after the window edge. */
const PACING_MARGIN_MS = 50;

export const TELEGRAM_PRIORITY_NORMAL = 'normal';
export const TELEGRAM_PRIORITY_LOW = 'low';

const priorityStorage = new AsyncLocalStorage();

/**
 * Run `fn` with every Bot API call it makes tagged with `priority`.
 *
 * Low priority is for traffic nobody is waiting for — periodic queue card edits,
 * progress refreshes. Such requests never wait and never retry: when the chat is
 * under flood control or its window is past the reserve, they fail at once with
 * a local throttle error (see `isTelegramLocalThrottleError`) and the caller
 * tries again on its next cycle.
 *
 * @template T
 * @param {'normal'|'low'} priority
 * @param {() => T} fn
 * @returns {T}
 */
export function withTelegramRequestPriority(priority, fn) {
  return priorityStorage.run(priority === TELEGRAM_PRIORITY_LOW ? TELEGRAM_PRIORITY_LOW : TELEGRAM_PRIORITY_NORMAL, fn);
}

export function getTelegramRequestPriority() {
  return priorityStorage.getStore() || TELEGRAM_PRIORITY_NORMAL;
}

/**
 * Build the error thrown when the governor refuses a request without sending
 * it. It mirrors Telegraf's `TelegramError` shape for a 429 so existing
 * handlers (`retry_after`, `error_code`) keep working, and carries
 * `localThrottle: true` so callers can tell it never reached Telegram.
 */
export function createTelegramLocalThrottleError({ method, chatId = null, retryAfterMs = 0, reason = 'rate_limit' }) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterMs / SECOND_MS));
  const description = `Too Many Requests: retry after ${retryAfter} (held locally: ${reason})`;
  const error = new Error(`429: ${description}`);
  error.name = 'TelegramLocalThrottleError';
  error.code = 429;
  error.localThrottle = true;
  error.reason = reason;
  error.response = { ok: false, error_code: 429, description, parameters: { retry_after: retryAfter } };
  error.parameters = error.response.parameters;
  error.description = description;
  error.on = { method, payload: chatId === null ? {} : { chat_id: chatId } };
  return error;
}

export function isTelegramLocalThrottleError(error) {
  return Boolean(error?.localThrottle);
}

/** True for a real or local 429 — anything that means "this chat is rate limited right now". */
export function isTelegramRateLimitError(error) {
  return isTelegramLocalThrottleError(error) || extractRateLimitError(error) !== null;
}

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

/**
 * Flood control is announced for one chat, so `retry_after` holds that chat
 * only. Calls without a chat (getUpdates, answerCallbackQuery) are held per
 * method, so one refused method cannot stall long polling.
 */
function blockKey(event) {
  return event.chatId !== null ? `chat:${event.chatId}` : `method:${event.method}`;
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
    // Issue #2571: what the governor did instead of letting Telegram refuse.
    this.delayedRequests = 0;
    this.delayedMs = 0;
    this.heldRequests = 0;
    this.retriedRequests = 0;
    this.lastHeld = null;
    /** @type {Map<string, {until: number, method: string, chatId: string|null}>} */
    this.blocks = new Map();
    this.rules = new Map(
      TELEGRAM_LIMIT_RULES.map(rule => [
        rule.id,
        {
          rule,
          limit: rule.documentedLimit,
          limitSource: rule.documentedLimit === null ? 'unknown' : 'documented',
          peak: 0,
          throttledUntil: null,
          refusedAt: null,
          refusedCount: null,
        },
      ])
    );
  }

  prune(now = this.now()) {
    const oldestRelevant = now - MAX_WINDOW_MS;
    this.events = this.events.filter(event => event.at > oldestRelevant);
    for (const [key, block] of this.blocks) {
      if (block.until <= now) this.blocks.delete(key);
    }
    this.refreshLimits(now);
  }

  /**
   * Let a limit lowered by a refusal recover once the refusal is old news.
   * Without this a single 429 caused by penalty state, or by our window being
   * misaligned with Telegram's, would cap the window for the life of the bot.
   */
  refreshLimits(now = this.now()) {
    for (const state of this.rules.values()) {
      if (state.refusedAt === null || now - state.refusedAt <= LIMIT_EVIDENCE_TTL_MS) continue;
      state.refusedAt = null;
      state.refusedCount = null;
      if (state.rule.documentedLimit !== null && state.limit < state.rule.documentedLimit) {
        state.limit = state.rule.documentedLimit;
        state.limitSource = 'documented';
      }
    }
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

  /** Timestamps of the requests in one rule's window for the key `event` falls in, oldest first. */
  windowEventTimes(rule, event, now) {
    const oldestRelevant = now - rule.windowMs;
    const key = ruleKey(rule, event);
    const times = [];
    for (const candidate of this.events) {
      if (candidate.at <= oldestRelevant || !ruleMatches(rule, candidate) || ruleKey(rule, candidate) !== key) continue;
      times.push(candidate.at);
    }
    return times;
  }

  /**
   * Decide whether a request may go out now (issue #2571).
   *
   * Returns `{ action: 'send' }`, `{ action: 'wait', waitMs, reason }` for a
   * normal-priority request that must be delayed, or `{ action: 'hold',
   * waitMs, reason }` for a low-priority request that should not be sent at all
   * this time. Planning and `recordRequest` must run in the same tick so two
   * concurrent callers cannot both take the last slot.
   */
  planRequest(method, payload = {}, { priority = TELEGRAM_PRIORITY_NORMAL } = {}) {
    const now = this.now();
    this.prune(now);
    const event = classifyTelegramRequest(method, payload);
    const low = priority === TELEGRAM_PRIORITY_LOW;

    const block = this.blocks.get(blockKey(event));
    if (block && block.until > now) {
      return { action: low ? 'hold' : 'wait', waitMs: block.until - now, reason: 'retry_after' };
    }

    let pacing = null;
    for (const rule of TELEGRAM_LIMIT_RULES) {
      if (!ruleMatches(rule, event)) continue;
      const { limit } = this.rules.get(rule.id);
      if (limit === null) continue;
      const allowed = low ? Math.max(1, Math.floor(limit * (1 - LOW_PRIORITY_RESERVE))) : limit;
      const times = this.windowEventTimes(rule, event, now);
      if (times.length < allowed) continue;
      // Wait until enough of the oldest requests leave the window to make room.
      const waitMs = times[times.length - allowed] + rule.windowMs - now + PACING_MARGIN_MS;
      if (!pacing || waitMs > pacing.waitMs) pacing = { waitMs, reason: `${rule.id}_window` };
    }
    if (pacing) return { action: low ? 'hold' : 'wait', ...pacing };
    return { action: 'send' };
  }

  recordDelay(ms) {
    this.delayedRequests++;
    this.delayedMs += Math.max(0, ms);
  }

  recordHeld(method, payload, plan, priority) {
    this.heldRequests++;
    const { chatId } = classifyTelegramRequest(method, payload);
    this.lastHeld = { method: String(method || ''), chatId, reason: plan.reason, waitMs: plan.waitMs, priority, observedAt: this.now() };
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

  /**
   * Telegram accepted the request, so every window it landed in tolerates its
   * count — unless a recent refusal says otherwise, in which case the windows
   * simply disagree and the refusal, the costlier mistake, wins.
   */
  recordSuccess(pending) {
    if (!pending?.counts) return;
    for (const [id, count] of pending.counts) {
      const state = this.rules.get(id);
      if (count > state.peak) state.peak = count;
      // An unknown limit stays unknown: a success proves capacity, never a ceiling.
      if (state.limit !== null && count > state.limit && state.refusedAt === null) {
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
      candidates.push({ state, count, utilization, explained: state.limit !== null && count > state.limit });
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
    if (blamed) {
      if (!blamed.explained) {
        // Telegram refused a window our estimate still considered allowed, so the
        // estimate is too high: the real limit is below the refused count.
        blamed.state.limit = Math.max(1, blamed.count - 1);
        blamed.state.limitSource = 'observed';
      }
      blamed.state.throttledUntil = retryUntil;
      blamed.state.refusedAt = at;
      blamed.state.refusedCount = blamed.state.refusedCount === null ? blamed.count : Math.min(blamed.state.refusedCount, blamed.count);
    }
    // Telegram told us when this chat may talk again; nothing to it goes out
    // before then (issue #2571). Without a retry_after the refusal still means
    // "not now", so hold for one second rather than not at all.
    if (pending?.event) {
      const until = retryUntil ?? at + SECOND_MS;
      const key = blockKey(pending.event);
      const existing = this.blocks.get(key);
      if (!existing || existing.until < until) this.blocks.set(key, { until, method: pending.event.method, chatId: pending.event.chatId });
    }

    this.lastRateLimit = {
      method: pending?.event?.method || 'unknown',
      chatId: pending?.event?.chatId ?? null,
      retryAfterSeconds: details.retryAfterSeconds,
      description: details.description,
      observedAt: at,
      retryUntil,
      ruleId: blamed?.state.rule.id ?? null,
      windowCount: blamed?.count ?? null,
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
      lowPriorityLimit: Math.max(1, Math.floor(state.limit * (1 - LOW_PRIORITY_RESERVE))),
    };
  }

  /** Chats and methods still under a `retry_after` hold, soonest release first. */
  describeBlocks(now) {
    return [...this.blocks.values()]
      .filter(block => block.until > now)
      .sort((a, b) => a.until - b.until)
      .map(block => ({ method: block.method, chatId: block.chatId, retryRemainingSeconds: Math.ceil((block.until - now) / SECOND_MS) }));
  }

  describeLastRateLimit(now) {
    if (!this.lastRateLimit) return null;
    const { retryUntil } = this.lastRateLimit;
    const retryRemainingSeconds = retryUntil === null ? null : Math.max(0, Math.ceil((retryUntil - now) / SECOND_MS));
    const ageSeconds = Math.max(0, Math.floor((now - this.lastRateLimit.observedAt) / SECOND_MS));
    return { ...this.lastRateLimit, retryRemainingSeconds, ageSeconds };
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
      blocks: this.describeBlocks(now),
      totalApiRequests: this.totalApiRequests,
      messageRequests: this.messageRequests,
      rateLimitResponses: this.rateLimitResponses,
      delayedRequests: this.delayedRequests,
      delayedMs: this.delayedMs,
      heldRequests: this.heldRequests,
      retriedRequests: this.retriedRequests,
      lastHeld: this.lastHeld,
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

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function formatWindows(counts) {
  return JSON.stringify(Object.fromEntries(counts || []));
}

/**
 * Govern every Bot API call from Telegraf's single `callApi` choke point, which
 * also carries `getUpdates` long polling.
 *
 * Results and non-429 errors pass through untouched. A request the governor
 * will not send fails with `createTelegramLocalThrottleError`, never silently.
 *
 * @param {object} telegram - Telegraf `Telegram` client
 * @param {object} [options]
 * @param {TelegramRateLimitTracker} [options.tracker] - shared state; every per-update client must use the same one
 * @param {boolean} [options.verbose]
 * @param {number} [options.maxWaitMs] - longest a normal-priority request may wait in total
 * @param {number} [options.maxRetries] - retries of a normal-priority request after a real 429
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function installTelegramRateLimitTracker(telegram, { tracker = defaultTracker, verbose = false, maxWaitMs = DEFAULT_MAX_WAIT_MS, maxRetries = DEFAULT_MAX_RETRIES, sleep = defaultSleep } = {}) {
  if (!telegram || telegram[TRACKER_INSTALLED]) return telegram;
  const originalCallApi = telegram.callApi;
  if (typeof originalCallApi !== 'function') return telegram;

  // Wait for the governor's permission; throws a local throttle error instead
  // of sending when the wait is not allowed. The request is recorded in the
  // same synchronous step as the decision, so concurrent callers cannot all
  // see the same free slot.
  async function admit(method, payload, priority, budget) {
    for (;;) {
      const plan = tracker.planRequest(method, payload, { priority });
      if (plan.action === 'send') return tracker.recordRequest(method, payload);
      const chat = payload?.chat_id ?? 'none';
      if (plan.action === 'hold' || plan.waitMs > budget.remainingMs) {
        tracker.recordHeld(method, payload, plan, priority);
        if (verbose) console.log(`[VERBOSE] Telegram Bot API ${method} held locally: chat=${chat} priority=${priority} reason=${plan.reason} wait=${Math.ceil(plan.waitMs)}ms budget=${Math.max(0, Math.round(budget.remainingMs))}ms`);
        throw createTelegramLocalThrottleError({ method, chatId: payload?.chat_id ?? null, retryAfterMs: plan.waitMs, reason: plan.reason });
      }
      tracker.recordDelay(plan.waitMs);
      if (verbose) console.log(`[VERBOSE] Telegram Bot API ${method} delayed ${Math.ceil(plan.waitMs)}ms: chat=${chat} reason=${plan.reason}`);
      budget.remainingMs -= plan.waitMs;
      await sleep(plan.waitMs);
    }
  }

  telegram.callApi = async function governedCallApi(method, payload = {}, ...rest) {
    const priority = getTelegramRequestPriority();
    const budget = { remainingMs: maxWaitMs };
    for (let attempt = 0; ; attempt++) {
      const pending = await admit(method, payload, priority, budget);
      try {
        const result = await originalCallApi.call(this, method, payload, ...rest);
        tracker.recordSuccess(pending);
        if (verbose) console.log(`[VERBOSE] Telegram Bot API ${method} accepted; windows: ${formatWindows(pending.counts)}`);
        return result;
      } catch (error) {
        const observed = tracker.recordError(error, pending);
        if (!observed) {
          // Issue #2571: failed calls (e.g. "message is not modified") still count
          // against Telegram's windows, so make them visible next to the counts.
          if (verbose) console.log(`[VERBOSE] Telegram Bot API ${method} failed (${error?.response?.error_code ?? error?.code ?? 'no code'}): ${error?.response?.description || error?.message}; windows: ${formatWindows(pending.counts)}`);
          throw error;
        }
        const retryAfterMs = observed.retryAfterSeconds === null ? null : observed.retryAfterSeconds * SECOND_MS;
        const willRetry = priority !== TELEGRAM_PRIORITY_LOW && attempt < maxRetries && retryAfterMs !== null && retryAfterMs <= budget.remainingMs;
        console.warn(`[telegram-bot] Telegram Bot API rate limit: method=${observed.method} chat=${observed.chatId ?? 'unknown'} retry_after=${observed.retryAfterSeconds ?? 'unknown'}s window=${observed.ruleId ?? 'unattributed'} windows=${formatWindows(pending.counts)} priority=${priority} at=${new Date(observed.observedAt).toISOString()}${willRetry ? ' (will retry)' : ''}`);
        if (verbose) console.error('[VERBOSE] Telegram Bot API 429 response:', JSON.stringify(error?.response || { message: error?.message }, null, 2));
        if (!willRetry) throw error;
        tracker.retriedRequests++;
      }
    }
  };

  telegram[TRACKER_INSTALLED] = true;
  return telegram;
}
