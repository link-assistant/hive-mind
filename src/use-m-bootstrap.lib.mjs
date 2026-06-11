#!/usr/bin/env node

import { ensureWritableNpmGlobalPrefix } from './npm-global-prefix.lib.mjs';

const defaultFetchUseMCode = async () => (await fetch('https://unpkg.com/use-m/use.js')).text();

/**
 * Load the use-m bootstrap after npm's global prefix has been made safe for
 * use-m's Node resolver.
 *
 * @param {object} [options]
 * @param {(message: string) => void} [options.log]
 * @param {() => Promise<string>} [options.fetchUseMCode]
 * @returns {Promise<Function>} The global use-m `use` function.
 */
export const ensureUseM = async (options = {}) => {
  const { log = message => console.log(message), fetchUseMCode = defaultFetchUseMCode } = options;
  await ensureWritableNpmGlobalPrefix({ log });
  if (typeof globalThis.use === 'undefined') {
    globalThis.use = (await eval(await fetchUseMCode())).use;
  }
  return globalThis.use;
};
