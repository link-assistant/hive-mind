#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ALWAYS_AUTH_LINE = /^[^\S\r\n]*always-auth[^\S\r\n]*=.*(?:\r?\n|$)/gim;

/**
 * Remove deprecated always-auth entries from npmrc content.
 * npm 11 warns about this key, while setup-node may still write it.
 * @param {string} content
 * @returns {{content: string, removed: boolean}}
 */
export function removeAlwaysAuthEntries(content) {
  const sanitized = String(content).replace(ALWAYS_AUTH_LINE, '');
  return {
    content: sanitized,
    removed: sanitized !== content,
  };
}

/**
 * Remove always-auth from the npm user config created by setup-node.
 * @param {object} options
 * @param {Record<string, string|undefined>} [options.env]
 * @param {{log: Function, warn: Function}} [options.logger]
 * @param {Function} [options.fileExists]
 * @param {Function} [options.readFile]
 * @param {Function} [options.writeFile]
 * @returns {{path: string, removed: boolean, skipped: boolean}}
 */
export function sanitizeNpmUserConfig({
  env = process.env,
  logger = console,
  fileExists = existsSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
} = {}) {
  const userConfigPath = env.NPM_CONFIG_USERCONFIG || '';

  if (!userConfigPath) {
    logger.log(
      'NPM_CONFIG_USERCONFIG is not set; no npm user config to clean.'
    );
    return { path: '', removed: false, skipped: true };
  }

  if (!fileExists(userConfigPath)) {
    logger.warn(`npm user config does not exist: ${userConfigPath}`);
    return { path: userConfigPath, removed: false, skipped: true };
  }

  const original = readFile(userConfigPath, 'utf8');
  const result = removeAlwaysAuthEntries(original);

  if (!result.removed) {
    logger.log(`No deprecated always-auth entry found in ${userConfigPath}.`);
    return { path: userConfigPath, removed: false, skipped: false };
  }

  writeFile(userConfigPath, result.content);
  logger.log(`Removed deprecated always-auth entry from ${userConfigPath}.`);
  return { path: userConfigPath, removed: true, skipped: false };
}

function isMainModule() {
  return process.argv[1]
    ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

if (isMainModule()) {
  sanitizeNpmUserConfig();
}
