/**
 * Watch how long Telegram update handlers keep the update loop busy.
 *
 * Every middleware registered through the bot (`use`, `on`, `command`,
 * `hears`, `action`, …) is wrapped. A handler that is still running after
 * `thresholdMs` is logged while it runs and again when it ends, so a stall
 * shows up in the log as it happens instead of only as silence. Time spent in
 * `next()` belongs to the later middleware and is not counted against the
 * caller.
 *
 * @module telegram-handler-watchdog.lib
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

export const DEFAULT_HANDLER_WARN_THRESHOLD_MS = 2000;

/** Composer methods whose arguments are all middleware. */
const MIDDLEWARE_ONLY_METHODS = ['use', 'start', 'help', 'settings', 'gameQuery'];
/** Composer methods whose first argument is a trigger and the rest middleware. */
const TRIGGER_METHODS = ['on', 'command', 'hears', 'action', 'inlineQuery', 'entity', 'mention', 'phone', 'hashtag', 'cashtag', 'email', 'url', 'textLink', 'textMention', 'spoiler', 'reaction', 'drop', 'filter'];

function describeTrigger(trigger) {
  if (Array.isArray(trigger)) return trigger.map(describeTrigger).join('|');
  if (trigger instanceof RegExp) return trigger.source;
  if (typeof trigger === 'function') return trigger.name || 'predicate';
  return String(trigger);
}

function describeUpdate(ctx) {
  const text = ctx?.message?.text;
  const command = typeof text === 'string' && text.startsWith('/') ? text.split(/\s/, 1)[0] : null;
  return `update ${ctx?.update?.update_id ?? '?'} in chat ${ctx?.chat?.id ?? '?'}${command ? ` (${command})` : ''}`;
}

/**
 * Wrap the bot's registration methods. Call it right after creating the bot,
 * before any handler is registered.
 *
 * @param {object} bot - A Telegraf instance (or anything with the same methods).
 * @param {object} [options]
 * @param {number} [options.thresholdMs]
 * @param {Console} [options.logger]
 * @param {Function} [options.now]
 * @param {Function} [options.setTimeoutImpl]
 * @param {Function} [options.clearTimeoutImpl]
 * @returns {{ getStats: () => object, wrapMiddleware: Function }}
 */
export function installHandlerWatchdog(bot, { thresholdMs = DEFAULT_HANDLER_WARN_THRESHOLD_MS, logger = console, now = () => Date.now(), setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  const stats = { handled: 0, slow: 0, running: 0, stalled: 0, slowestMs: 0, slowestHandler: null };
  const runningEntries = new Set();

  function wrapMiddleware(label, middleware) {
    if (typeof middleware !== 'function') return middleware;
    return function watchedMiddleware(ctx, next) {
      const startedAt = now();
      let inNextMs = 0;
      let nextStartedAt = null;
      const ownMs = () => now() - startedAt - inNextMs - (nextStartedAt === null ? 0 : now() - nextStartedAt);
      const entry = { label, ctx, warned: false };
      let timer = null;
      const check = () => {
        timer = null;
        const elapsed = ownMs();
        if (elapsed >= thresholdMs) {
          entry.warned = true;
          stats.stalled += 1;
          logger.warn(`[telegram-bot] Handler ${label} has been running for ${elapsed} ms on ${describeUpdate(ctx)}; later updates wait for it.`);
          return;
        }
        arm(thresholdMs - elapsed);
      };
      const arm = delay => {
        timer = setTimeoutImpl(check, Math.max(delay, 1));
        if (timer && typeof timer.unref === 'function') timer.unref();
      };
      const finish = () => {
        if (timer !== null) clearTimeoutImpl(timer);
        timer = null;
        runningEntries.delete(entry);
        stats.running = runningEntries.size;
        stats.handled += 1;
        const elapsed = ownMs();
        if (elapsed > stats.slowestMs) {
          stats.slowestMs = elapsed;
          stats.slowestHandler = label;
        }
        if (elapsed >= thresholdMs) {
          stats.slow += 1;
          logger.warn(`[telegram-bot] Handler ${label} held ${describeUpdate(ctx)} for ${elapsed} ms (threshold ${thresholdMs} ms).`);
        }
      };
      const timedNext =
        typeof next === 'function'
          ? (...args) => {
              nextStartedAt = now();
              return Promise.resolve(next(...args)).finally(() => {
                inNextMs += now() - nextStartedAt;
                nextStartedAt = null;
              });
            }
          : next;
      runningEntries.add(entry);
      stats.running = runningEntries.size;
      arm(thresholdMs);
      let result;
      try {
        result = middleware(ctx, timedNext);
      } catch (error) {
        finish();
        throw error;
      }
      if (!result || typeof result.then !== 'function') {
        finish();
        return result;
      }
      return Promise.resolve(result).finally(finish);
    };
  }

  // Telegraf implements `command`, `start`, … on top of `use`; only the
  // outermost registration call wraps, so each handler is timed once.
  let registering = 0;
  const patch = (method, wrapArgs) => {
    if (typeof bot[method] !== 'function') return;
    const original = bot[method].bind(bot);
    bot[method] = (...args) => {
      if (registering > 0) return original(...args);
      registering += 1;
      try {
        return original(...wrapArgs(args));
      } finally {
        registering -= 1;
      }
    };
  };
  for (const method of MIDDLEWARE_ONLY_METHODS) {
    patch(method, fns => fns.map((fn, index) => wrapMiddleware(`${method}(${fn?.name || `#${index}`})`, fn)));
  }
  for (const method of TRIGGER_METHODS) {
    patch(method, ([trigger, ...fns]) => [trigger, ...fns.map(fn => wrapMiddleware(`${method}(${describeTrigger(trigger)})`, fn))]);
  }

  return {
    wrapMiddleware,
    getStats() {
      return { ...stats, thresholdMs };
    },
  };
}
