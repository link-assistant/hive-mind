#!/usr/bin/env node

// Candidate URLs for the use-m bootstrap bundle, in priority order.
//
// The primary entry (https://unpkg.com/use-m/use.js) used to be served from the
// package root. use-m@8.14.0 relocated the bundle to `src/use.js`, so the
// unversioned root URL started returning `404 Not found` and every command that
// eval()'d the 404 body crashed with `SyntaxError: Unexpected identifier
// 'found'` (issue #1733). The list below keeps the original URL first (so older,
// good use-m releases keep working) and falls back to the new layout and a
// second CDN so a single upstream/CDN hiccup no longer breaks the whole CLI.
export const USE_M_CODE_URLS = Object.freeze(['https://unpkg.com/use-m/use.js', 'https://unpkg.com/use-m/src/use.js', 'https://cdn.jsdelivr.net/npm/use-m/use.js', 'https://cdn.jsdelivr.net/npm/use-m/src/use.js']);

// A CDN can answer 200 with an HTML/text error page instead of the bundle.
// Reject obvious non-JavaScript bodies so we keep trying the next candidate
// rather than eval()'ing garbage.
const looksLikeError = code => !code || /^\s*Not found:/i.test(code) || /^\s*<(?:!doctype|html)/i.test(code);

/**
 * Fetch the use-m bootstrap source, trying each candidate URL until one returns
 * a usable JavaScript bundle.
 *
 * @param {object} [options]
 * @param {(url: string) => Promise<Response>} [options.fetchImpl] - fetch override (tests).
 * @param {readonly string[]} [options.urls] - candidate URLs override (tests).
 * @returns {Promise<string>} The use-m bootstrap source code.
 */
export const loadUseMCode = async ({ fetchImpl = fetch, urls = USE_M_CODE_URLS } = {}) => {
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        lastError = new Error(`Failed to fetch use-m bootstrap from ${url}: HTTP ${response.status}`);
        continue;
      }
      const code = await response.text();
      if (looksLikeError(code)) {
        lastError = new Error(`Unexpected use-m bootstrap body from ${url}`);
        continue;
      }
      return code;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Failed to fetch use-m bootstrap code from all known sources');
};

const defaultFetchUseMCode = () => loadUseMCode();

/**
 * Load the shared use-m bootstrap.
 *
 * @param {object} [options]
 * @param {() => Promise<string>} [options.fetchUseMCode]
 * @returns {Promise<Function>} The global use-m `use` function.
 */
export const ensureUseM = async (options = {}) => {
  const { fetchUseMCode = defaultFetchUseMCode } = options;
  if (typeof globalThis.use === 'undefined') {
    globalThis.use = (await eval(await fetchUseMCode())).use;
  }
  return globalThis.use;
};
