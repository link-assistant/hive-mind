#!/usr/bin/env node

const defaultFetchUseMCode = async () => (await fetch('https://unpkg.com/use-m/use.js')).text();

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
