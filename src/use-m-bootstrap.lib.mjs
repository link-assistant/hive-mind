#!/usr/bin/env node

export const USE_M_BOOTSTRAP_URL = 'https://unpkg.com/use-m/use.js';
export const USE_M_BOOTSTRAP_FALLBACK_URL = 'https://unpkg.com/use-m@8.13.8/use.js';

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
    throw new Error(`Failed to load use-m bootstrap from primary and fallback URLs: ${primaryError.message}; ${fallbackError.message}`);
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
    try {
      globalThis.use = (await eval(await fetchUseMCode())).use;
    } catch (error) {
      if (typeof log === 'function') log(`   use-m latest bootstrap failed (${error.message}); trying ${USE_M_BOOTSTRAP_FALLBACK_URL}`);
      globalThis.use = (await eval(await fallbackFetchUseMCode())).use;
    }
  }
  return globalThis.use;
};
