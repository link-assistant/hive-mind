/**
 * Issue #2837: identifiers of the account the AI tools are logged in with.
 *
 * Codex OTEL tracing and Anthropic SDK debug logging stamp the operator's
 * e-mail address, account UUID and organization ID onto almost every line.
 * The field-shaped occurrences (`user.email="…"`, `anthropic-organization-id:`)
 * are redacted by the dependency-free core; this module supplies the actual
 * values from the local auth files, so the same identifiers are also redacted
 * wherever else they surface (a JSON dump, a tool result, a stack trace) and
 * the publication boundary can verify that none of them survived.
 *
 * Only identifiers are collected, never credentials: tokens in the same files
 * are covered by the credential sanitizer.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const decodeJwtPayload = token => {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0;

const readJsonWithStamp = async (filePath, fsImpl) => {
  try {
    const stat = await fsImpl.stat(filePath);
    return { stamp: `${filePath}:${stat.mtimeMs}:${stat.size}`, read: async () => JSON.parse(await fsImpl.readFile(filePath, 'utf8')) };
  } catch {
    return { stamp: `${filePath}:missing`, read: async () => null };
  }
};

/**
 * Extract identity values from a parsed Codex `auth.json`.
 * @param {Object|null} auth
 * @returns {Array<{name: string, value: string}>}
 */
export const extractCodexIdentityValues = auth => {
  if (!auth || typeof auth !== 'object') return [];
  const out = [];
  const add = (name, value) => isNonEmptyString(value) && out.push({ name, value: value.trim() });
  add('codex-account-id', auth.tokens?.account_id);
  for (const token of [auth.tokens?.id_token, auth.tokens?.access_token]) {
    const payload = decodeJwtPayload(typeof token === 'object' && token ? token.raw_jwt : token);
    if (!payload) continue;
    add('codex-email', payload.email);
    add('codex-email', payload['https://api.openai.com/profile']?.email);
    const claims = payload['https://api.openai.com/auth'] || {};
    add('codex-account-id', claims.chatgpt_account_id);
    add('codex-user-id', claims.chatgpt_user_id);
    add('codex-user-id', claims.user_id);
    for (const organization of Array.isArray(claims.organizations) ? claims.organizations : []) add('codex-organization-id', organization?.id);
  }
  return out;
};

/**
 * Extract identity values from a parsed Claude Code `.claude.json`.
 * @param {Object|null} config
 * @returns {Array<{name: string, value: string}>}
 */
export const extractClaudeIdentityValues = config => {
  const account = config?.oauthAccount;
  if (!account || typeof account !== 'object') return [];
  return [
    ['claude-email', account.emailAddress],
    ['claude-account-id', account.accountUuid],
    ['claude-organization-id', account.organizationUuid],
  ]
    .filter(([, value]) => isNonEmptyString(value))
    .map(([name, value]) => ({ name, value: value.trim() }));
};

/**
 * Auth files that may hold the identity of the account in use.
 * @param {Object} [options]
 * @returns {Array<{path: string, extract: Function}>}
 */
export const getAccountIdentitySources = ({ env = process.env, homeDir = os.homedir() } = {}) => {
  const codexHomes = [...new Set([env.CODEX_HOME, env.HIVE_MIND_PARENT_CODEX_HOME, path.join(homeDir, '.codex')].filter(isNonEmptyString))];
  const claudeDirs = [...new Set([env.CLAUDE_CONFIG_DIR, homeDir].filter(isNonEmptyString))];
  return [...codexHomes.map(dir => ({ path: path.join(dir, 'auth.json'), extract: extractCodexIdentityValues })), ...claudeDirs.map(dir => ({ path: path.join(dir, '.claude.json'), extract: extractClaudeIdentityValues }))];
};

let identityCache = null;

/** Tests only: forget the cached identity values. */
export const resetAccountIdentityCache = () => {
  identityCache = null;
};

/**
 * Identity values of every locally authenticated AI tool account.
 *
 * Publication sanitizes large logs chunk by chunk, so the parsed values are
 * cached and re-read only when one of the auth files changes (re-login).
 *
 * @param {Object} [options]
 * @returns {Promise<Array<{source: string, name: string, value: string}>>}
 */
export const getAccountIdentityValues = async ({ env = process.env, homeDir = os.homedir(), fsImpl = fs } = {}) => {
  const sources = getAccountIdentitySources({ env, homeDir });
  const stamped = await Promise.all(sources.map(source => readJsonWithStamp(source.path, fsImpl)));
  const cacheKey = stamped.map(entry => entry.stamp).join('|');
  if (identityCache?.key === cacheKey) return identityCache.values;

  const values = [];
  const seen = new Set();
  for (const [index, source] of sources.entries()) {
    let parsed = null;
    try {
      parsed = await stamped[index].read();
    } catch {
      // An unreadable or half-written auth file holds nothing we can use.
    }
    for (const { name, value } of source.extract(parsed)) {
      if (seen.has(value)) continue;
      seen.add(value);
      values.push({ source: 'account-identity', name, value });
    }
  }
  identityCache = { key: cacheKey, values };
  return values;
};
