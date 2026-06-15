#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';

const USE_M_BOOTSTRAP_URLS = ['https://unpkg.com/use-m/use.js', 'https://unpkg.com/use-m@8.13.8/use.js'];
const USE_M_BOOTSTRAP_CACHE = process.env.HIVE_MIND_USE_M_BOOTSTRAP_CACHE || join(os.tmpdir(), 'hive-mind-use-m-bootstrap.js');

const isMissingUnpkgResponse = code => code.trim().startsWith('Not found:');

const readCachedUseMCode = async () => {
  try {
    const code = await readFile(USE_M_BOOTSTRAP_CACHE, 'utf8');
    if (!isMissingUnpkgResponse(code)) return code;
  } catch {
    // Cache misses should fall through to the network bootstrap.
  }
  return null;
};

const writeCachedUseMCode = async code => {
  try {
    await mkdir(dirname(USE_M_BOOTSTRAP_CACHE), { recursive: true });
    await writeFile(USE_M_BOOTSTRAP_CACHE, code);
  } catch {
    // The cache only avoids repeated startup fetches; loading can continue.
  }
};

const defaultFetchUseMCode = async () => {
  const cachedCode = await readCachedUseMCode();
  if (cachedCode) return cachedCode;

  let lastError = null;
  for (const url of USE_M_BOOTSTRAP_URLS) {
    try {
      const response = await fetch(url);
      const code = await response.text();
      if (response.ok && !isMissingUnpkgResponse(code)) {
        await writeCachedUseMCode(code);
        return code;
      }
      lastError = new Error(`Failed to load ${url}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Failed to load use-m bootstrap');
};

export const loadUseMFromCode = async code => {
  try {
    const legacyBootstrap = await eval(code);
    if (typeof legacyBootstrap?.use === 'function') return legacyBootstrap.use;
  } catch {
    // Fall through to CommonJS bootstrap support.
  }

  const cjsModule = { exports: {} };
  const cjsExports = cjsModule.exports;
  const cjsBootstrap = Function('module', 'exports', `${code}\n;return module.exports;`)(cjsModule, cjsExports);
  if (typeof cjsBootstrap?.use === 'function') return cjsBootstrap.use;
  throw new Error('Loaded use-m bootstrap did not export a use function');
};

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
    globalThis.use = await loadUseMFromCode(await fetchUseMCode());
  }
  return globalThis.use;
};
