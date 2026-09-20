/**
 * Credential sanitization for everything Hive Mind hands to Sentry.
 *
 * `src/instrument.mjs` has always masked credentials in *events* (`beforeSend`).
 * Structured logs are a second, separate pipeline: `enableLogs` sends
 * `Sentry.logger.*` records straight to the transport, and `beforeSend` is never
 * called for them. Sentry 10.71 made `enableLogs` the default, so any consumer
 * that has not opted out now ships that pipeline whether it meant to or not —
 * which is why the same masking is applied through `beforeSendLog` here.
 *
 * Both hooks share one walker so a token can never be masked in one surface and
 * printed verbatim in the other.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { sanitizeCredentialText } from './credential-sanitization-core.lib.mjs';

/**
 * Recursively mask credentials in a Sentry payload, in place.
 *
 * Mutates rather than clones on purpose: Sentry hands us the object it is about
 * to serialize, and a copy would leave the original untouched. Cycles are
 * tracked so a self-referencing payload cannot spin forever — the same class of
 * unbounded work this issue is about.
 *
 * @param {*} value - Any part of a Sentry event or log record
 * @param {WeakSet} [seen] - Cycle guard, supplied by the recursion
 * @returns {*} The same value with every string masked
 */
export const sanitizeSentryValue = (value, seen = new WeakSet()) => {
  if (typeof value === 'string') return sanitizeCredentialText(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    value[key] = sanitizeSentryValue(item, seen);
  }
  return value;
};

/**
 * `beforeSendLog` hook: mask credentials in a structured log record.
 *
 * Returns the record (never `null`) so sanitization only ever changes the
 * content of a log, never whether it is delivered — dropping logs silently
 * would recreate the blind spot described in Finding F5.
 *
 * @param {Object} log - The log record Sentry is about to send
 * @returns {Object} The same record, masked
 */
export const sanitizeSentryLog = log => sanitizeSentryValue(log);
