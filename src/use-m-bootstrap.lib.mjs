#!/usr/bin/env node

import { wrapUseWithRetry } from './use-with-retry.lib.mjs';
import { wrapUseWithSingleFlight } from './use-m-single-flight.lib.mjs';

export const USE_M_BOOTSTRAP_URL = 'https://unpkg.com/use-m/use.js';
// Issue #2113: the fallback is only reached when unpkg cannot serve the `latest`
// bundle, but until now it pinned 8.13.8 — the last release *without* any
// corrupt-alias self-healing. A CDN hiccup therefore silently downgraded every
// dependency import to the least resilient loader available. 8.14.4 is the first
// release that both repairs corrupt aliases (8.14.3, use-m #66/#67) and removes
// them with a retry budget (8.14.4, use-m #68), so the degraded path now keeps
// upstream recovery instead of losing it. 8.15.0 (use-m #70, the report filed
// from this issue) additionally serialises installs of one alias across
// processes with its own `.use-m/<alias>.lock` plus a post-install marker, so
// the pinned fallback now carries upstream prevention too — verified with the
// standalone reproduction: 8.14.4 fails 22/24 concurrent loads, 8.15.0 fails
// 0/24 (docs/case-studies/issue-2113/raw/experiment-upstream-use-m-8.15.0-fixed.log).
export const USE_M_BOOTSTRAP_FALLBACK_URL = 'https://unpkg.com/use-m@8.15.0/use.js';

const isMissingUseMBundle = code => /^Not found: \/use-m@[^/]+\/use\.js\s*$/.test(code.trim());

const readBootstrapResponse = async (response, url) => {
  const code = await response.text();
  if (response.ok !== false && !isMissingUseMBundle(code)) return code;
  throw new Error(`use-m bootstrap was not available at ${url}: ${code.slice(0, 120)}`);
};

const fetchUseMCodeFromUrl = async (url, fetcher = fetch) => readBootstrapResponse(await fetcher(url), url);

export const fetchUseMCodeFromCdn = async ({ fetcher = fetch } = {}) => {
  let primaryError;
  try {
    return await fetchUseMCodeFromUrl(USE_M_BOOTSTRAP_URL, fetcher);
  } catch (error) {
    primaryError = error;
  }

  try {
    return await fetchUseMCodeFromUrl(USE_M_BOOTSTRAP_FALLBACK_URL, fetcher);
  } catch (fallbackError) {
    throw new Error(`Failed to load use-m bootstrap from primary and fallback URLs: ${primaryError.message}; ${fallbackError.message}`, { cause: fallbackError });
  }
};

const defaultFetchUseMCode = () => fetchUseMCodeFromUrl(USE_M_BOOTSTRAP_URL);
const fallbackFetchUseMCode = () => fetchUseMCodeFromUrl(USE_M_BOOTSTRAP_FALLBACK_URL);

/**
 * Load the shared use-m bootstrap.
 *
 * @param {object} [options]
 * @param {() => Promise<string>} [options.fetchUseMCode]
 * @returns {Promise<Function>} The global use-m `use` function.
 */
export const ensureUseM = async (options = {}) => {
  const { fetchUseMCode = defaultFetchUseMCode, log = null } = options;
  if (typeof globalThis.use === 'undefined') {
    let rawUse;
    try {
      rawUse = (await eval(await fetchUseMCode())).use;
    } catch (error) {
      if (typeof log === 'function') log(`   use-m latest bootstrap failed (${error.message}); trying ${USE_M_BOOTSTRAP_FALLBACK_URL}`);
      rawUse = (await eval(await fallbackFetchUseMCode())).use;
    }
    // Issue #2092: a truncated global `npm install -g <pkg>` makes use-m throw
    // `Failed to import module from '<...>/command-stream-v-latest/src/$.mjs'.`
    // Only a few call sites used useWithRetry explicitly; wrapping here means
    // every `await use(...)` in the codebase recovers by deleting the corrupt
    // install directory and re-fetching.
    //
    // Issue #2113: retrying alone is not enough. use-m runs one
    // `npm install -g <alias>@npm:<pkg>@<version>` per `use()` call with no
    // in-flight dedup, and 38 modules under src/ load command-stream through
    // use(), 31 of them with a top-level
    // `await use('command-stream')`. Node evaluates sibling top-level-await
    // subgraphs concurrently, so a cold container fires dozens of simultaneous
    // global installs of the *same* alias directory; they delete and re-extract
    // each other's trees, producing the ENOTEMPTY and half-extracted-package
    // failures recorded in the issue. Every retry re-enters the same race, so
    // the single-flight layer wraps the retry layer: identical loads collapse
    // into one install, and installs of the same alias are serialised within
    // and across processes.
    globalThis.use = wrapUseWithSingleFlight(wrapUseWithRetry(rawUse));
  } else {
    globalThis.use = wrapUseWithSingleFlight(wrapUseWithRetry(globalThis.use));
  }
  return globalThis.use;
};
