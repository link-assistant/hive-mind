#!/usr/bin/env node

export const USE_M_BOOTSTRAP_URL = 'https://unpkg.com/use-m/use.js';
export const USE_M_FALLBACK_BOOTSTRAP_URL = 'https://unpkg.com/use-m@8.13.8/use.js';

const fetchUseMCodeFromUrl = async url => {
  const response = await fetch(url);
  const code = await response.text();
  if (!response.ok || /^Not found:/i.test(code.trim())) {
    throw new Error(`failed to load use-m bootstrap from ${url}: ${response.status} ${response.statusText}`);
  }
  return code;
};

const defaultFetchUseMCode = async () => fetchUseMCodeFromUrl(USE_M_BOOTSTRAP_URL);
const fallbackFetchUseMCode = async () => fetchUseMCodeFromUrl(USE_M_FALLBACK_BOOTSTRAP_URL);

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
      if (typeof log === 'function') log(`   use-m latest bootstrap failed (${error.message}); trying ${USE_M_FALLBACK_BOOTSTRAP_URL}`);
      globalThis.use = (await eval(await fallbackFetchUseMCode())).use;
    }
  }
  return globalThis.use;
};
