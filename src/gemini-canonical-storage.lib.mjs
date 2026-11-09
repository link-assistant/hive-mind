/** Admit independent selected Gemini parents without executing native code. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { absoluteCanonicalStoragePath, readCanonicalAuthFile } from './canonical-auth-file.lib.mjs';

export const nativeGeminiStorageRefusal = () => Object.assign(new Error('Selected native Gemini storage or command is unavailable or unsafe; execution was refused.'), { code: 'NATIVE_GEMINI_STORAGE_VIOLATION' });
const refused = nativeGeminiStorageRefusal;
const names = new Map([
  ['auth', ['GEMINI_AUTH_HOME', 'HIVE_MIND_GEMINI_AUTH_IDENTITY']],
  ['history', ['GEMINI_HISTORY_HOME', 'HIVE_MIND_GEMINI_HISTORY_IDENTITY']],
]);
const overlaps = (left, right) => left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
const alternateAuthorities = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_ACCESS_TOKEN', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA', 'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE'];

async function configurationHomes(env, homeDir) {
  const roots = new Set([homeDir, ...(env.HOME !== undefined ? [env.HOME] : []), ...(env.GEMINI_CLI_HOME !== undefined ? [env.GEMINI_CLI_HOME] : [])]);
  const configurations = [];
  for (const root of roots) {
    if (!absoluteCanonicalStoragePath(root) || (await fs.realpath(root)) !== root) throw refused();
    const configuration = path.join(root, '.gemini');
    const info = await fs.lstat(configuration).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink() || (await fs.realpath(configuration)) !== configuration)) throw refused();
    configurations.push(configuration);
  }
  return configurations;
}

async function directoryIdentity(root, expected) {
  let descriptor;
  try {
    if (process.platform !== 'linux' || !absoluteCanonicalStoragePath(root) || (await fs.realpath(root)) !== root) throw refused();
    descriptor = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const held = await descriptor.stat({ bigint: true });
    const identity = `${held.dev}:${held.ino}`;
    const visible = await fs.lstat(root, { bigint: true });
    if (!held.isDirectory() || held.uid !== BigInt(process.getuid()) || (held.mode & 0o077n) !== 0n || !visible.isDirectory() || `${visible.dev}:${visible.ino}` !== identity || visible.uid !== held.uid || (visible.mode & 0o077n) !== 0n || (await fs.realpath(root)) !== root) throw refused();
    if (expected !== undefined && (!/^[0-9]{1,20}:[0-9]{1,20}$/u.test(expected) || expected !== identity)) throw refused();
    return identity;
  } finally {
    await descriptor?.close();
  }
}

async function storage(env, homeDir, expected) {
  const configurations = await configurationHomes(env, homeDir);
  const selection = {};
  const forwarded = {};
  for (const [kind, [selector, marker]] of names) {
    const root = env[selector];
    const inherited = env[marker];
    const previous = expected?.selection[kind];
    if (root === undefined && inherited === undefined && !previous) continue;
    if (!absoluteCanonicalStoragePath(root) || configurations.some(configuration => overlaps(root, configuration))) throw refused();
    const identity = await directoryIdentity(root, inherited ?? previous?.identity);
    if (expected !== undefined && (!previous || previous.root !== root || previous.identity !== identity || (previous.marker !== undefined && previous.marker !== inherited))) throw refused();
    selection[kind] = { root, identity, marker: inherited };
    forwarded[selector] = root;
    forwarded[marker] = identity;
    if (kind === 'auth') {
      if (alternateAuthorities.some(name => env[name] !== undefined)) throw refused();
      for (const configurationHome of configurations) {
        const credentials = await readCanonicalAuthFile(root, { configurationHome, expectedIdentity: identity, filename: 'oauth_creds.json', refused });
        if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || !['access_token', 'refresh_token', 'token_type'].every(field => typeof credentials[field] === 'string' && credentials[field].length > 0) || !Number.isFinite(credentials.expiry_date) || credentials.expiry_date <= 0) throw refused();
        const competingAccounts = await fs.lstat(path.join(configurationHome, 'google_accounts.json')).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (competingAccounts) throw refused();
      }
    }
  }
  if (selection.auth && selection.history && overlaps(selection.auth.root, selection.history.root)) throw refused();
  return { selection, env: forwarded };
}

/** Keep this opaque admission through preparation and mount-source resolution. */
export async function admitGeminiCanonicalStorage({ env = process.env, homeDir = os.homedir(), expected } = {}) {
  try {
    const selected = [...names.values()].some(([selector, marker]) => env[selector] !== undefined || env[marker] !== undefined);
    if (!selected && !expected) return null;
    if (expected === null) throw refused();
    return await storage(env, homeDir, expected);
  } catch {
    throw refused();
  }
}
