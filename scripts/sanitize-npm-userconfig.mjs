#!/usr/bin/env node

/**
 * Remove the deprecated `always-auth` key from the npm user config (~/.npmrc).
 *
 * Why (issue #2028): `actions/setup-node` with `registry-url` writes an
 * `always-auth` entry into the runner's ~/.npmrc. Once the release job upgrades
 * to npm 11 (see scripts/setup-npm.mjs), every npm invocation prints:
 *
 *   npm warn Unknown user config "always-auth". This will stop working in the
 *   next major version of npm.
 *
 * The key is obsolete (npm always sends auth for the configured registry), so it
 * is safe to strip. Removing it keeps the release logs clean and avoids a
 * warning the issue asks us to eliminate.
 *
 * Ported from
 * link-foundation/js-ai-driven-development-pipeline-template.
 *
 * Uses only Node built-ins.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Matches a whole line that sets `always-auth` (any casing / spacing), e.g.
//   always-auth=true
//   always_auth = false
export const ALWAYS_AUTH_LINE = /^\s*always[-_]auth\s*=.*$/gim;

/**
 * Remove any `always-auth` entries from an .npmrc file's contents.
 * @param {string} content
 * @returns {{content:string, removed:number}}
 */
export function removeAlwaysAuthEntries(content) {
  const matches = content.match(ALWAYS_AUTH_LINE);
  const removed = matches ? matches.length : 0;
  if (!removed) {
    return { content, removed: 0 };
  }
  // Drop the matching lines, then collapse the blank line they leave behind.
  const cleaned = content
    .replace(ALWAYS_AUTH_LINE, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
  return { content: cleaned, removed };
}

/**
 * Sanitize the npm user config file, removing deprecated `always-auth` entries.
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(path:string)=>boolean} [opts.exists]
 * @param {(path:string, enc:string)=>string} [opts.reader]
 * @param {(path:string, data:string)=>void} [opts.writer]
 * @param {Console} [opts.logger]
 * @returns {{path:string|null, removed:number, changed:boolean}}
 */
export function sanitizeNpmUserConfig({ env = process.env, exists = existsSync, reader = readFileSync, writer = writeFileSync, logger = console } = {}) {
  // npm honours the NPM_CONFIG_USERCONFIG override, else ~/.npmrc.
  const npmrcPath = env.NPM_CONFIG_USERCONFIG || join(homedir(), '.npmrc');

  if (!exists(npmrcPath)) {
    logger.log(`No npm user config at ${npmrcPath}; nothing to sanitize`);
    return { path: null, removed: 0, changed: false };
  }

  const original = reader(npmrcPath, 'utf8');
  const { content, removed } = removeAlwaysAuthEntries(original);

  if (removed === 0) {
    logger.log(`No deprecated always-auth entries found in ${npmrcPath}`);
    return { path: npmrcPath, removed: 0, changed: false };
  }

  writer(npmrcPath, content);
  logger.log(`Removed ${removed} deprecated always-auth entry(ies) from ${npmrcPath}`);
  return { path: npmrcPath, removed, changed: true };
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sanitize-npm-userconfig.mjs');
if (isMain) {
  try {
    sanitizeNpmUserConfig();
  } catch (error) {
    console.error('Error sanitizing npm user config:', error.message);
    process.exit(1);
  }
}
