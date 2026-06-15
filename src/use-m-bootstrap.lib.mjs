#!/usr/bin/env node

export const USE_M_BOOTSTRAP_URL = 'https://unpkg.com/use-m/use.js';
export const USE_M_BOOTSTRAP_FALLBACK_URL = 'https://unpkg.com/use-m@8.13.8/use.js';

const isMissingUseMBundle = code => /^Not found: \/use-m@[^/]+\/use\.js\s*$/.test(code.trim());

const readBootstrapResponse = async (response, url) => {
  const code = await response.text();
  if (response.ok !== false && !isMissingUseMBundle(code)) return code;
  throw new Error(`use-m bootstrap was not available at ${url}: ${code.slice(0, 120)}`);
};

export const fetchUseMCodeFromCdn = async ({ fetcher = fetch } = {}) => {
  let primaryError;
  try {
    return await readBootstrapResponse(await fetcher(USE_M_BOOTSTRAP_URL), USE_M_BOOTSTRAP_URL);
  } catch (error) {
    primaryError = error;
  }

  try {
    return await readBootstrapResponse(await fetcher(USE_M_BOOTSTRAP_FALLBACK_URL), USE_M_BOOTSTRAP_FALLBACK_URL);
  } catch (fallbackError) {
    throw new Error(`Failed to load use-m bootstrap from primary and fallback URLs: ${primaryError.message}; ${fallbackError.message}`);
  }
};

const defaultFetchUseMCode = () => fetchUseMCodeFromCdn();

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
