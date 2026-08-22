#!/usr/bin/env node
/**
 * Telegram leak-notifier (Issue #1745)
 *
 * The interactive AI bridge calls `reportInteractiveLeak()` whenever it
 * detects that a comment body it was about to publish contained a
 * known-local token. The sanitizer masks the token before it goes out, but
 * we still want the chat owner who started the session to know — quickly,
 * out-of-band — so they can rotate the token immediately.
 *
 * The Telegram bot calls `registerLeakNotifier()` on startup with a callback
 * that knows how to DM the chat owner. We keep this contract intentionally
 * small (callback-based, no direct telegraf import) so:
 *
 *   1. interactive-mode.lib.mjs doesn't have to depend on telegraf at all
 *      (avoids a heavy import in the AI subprocess).
 *   2. Tests can register a no-op (or assertion-collecting) notifier.
 *   3. solve.mjs running outside the Telegram bot process degrades gracefully
 *      to a console warning.
 *
 * @see docs/case-studies/issue-1745/analysis.md
 * @module telegram-leak-notifier
 */

let registeredNotifier = null;

/**
 * Telegram bot calls this once during startup so the AI bridge has a way
 * to send out-of-band leak warnings.
 *
 * @param {Function} notifier  async ({ owner, repo, prNumber, tokenHits }) => void
 */
export const registerLeakNotifier = notifier => {
  registeredNotifier = typeof notifier === 'function' ? notifier : null;
};

/** Test hook — clear the registered notifier between tests. */
export const clearLeakNotifierForTests = () => {
  registeredNotifier = null;
};

/**
 * Issue #1745 — fired by interactive-mode.lib.mjs when it had to mask a
 * known-local token in an outbound comment.
 *
 * Always succeeds. If no notifier is registered (we're running outside the
 * Telegram bot process) it falls back to a structured console warning.
 *
 * @param {Object} params
 * @param {string} params.owner       repo owner
 * @param {string} params.repo        repo name
 * @param {number} [params.prNumber]  pull-request number, when applicable
 * @param {Array<{name: string, source: string}>} [params.tokenHits]
 *   list of token identifiers (NEVER the values) that were detected.
 * @param {Function} [params.log]     async logger from interactive-mode
 */
export const reportInteractiveLeak = async ({ owner, repo, prNumber, tokenHits = [], log } = {}) => {
  const fallbackLog = log || (async msg => console.warn(msg));

  const summary = tokenHits.length ? tokenHits.map(h => `${h.name} (${h.source})`).join(', ') : 'unknown';

  const where = prNumber ? `${owner}/${repo}#${prNumber}` : `${owner}/${repo}`;

  await fallbackLog(`🚨 Token-leak event: ${summary} found in outbound comment for ${where} (sanitizer masked it).`);

  if (registeredNotifier) {
    try {
      await registeredNotifier({ owner, repo, prNumber, tokenHits });
    } catch (err) {
      await fallbackLog(`⚠️ Telegram leak notifier threw: ${err.message}`);
    }
  }
};

export default {
  registerLeakNotifier,
  reportInteractiveLeak,
  clearLeakNotifierForTests,
};
