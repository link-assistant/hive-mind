/** Admission metadata applies to the dedicated Docker authority, not stock homes. */
import os from 'node:os';
import path from 'node:path';
import { absoluteCanonicalStoragePath, readCanonicalAuthFile } from './canonical-auth-file.lib.mjs';
import { resolveClaudeConfigDirectory } from './claude-paths.lib.mjs';
import { isReservedClaudeAuthority } from './claude-auth-authority.lib.mjs';

const refused = () => new Error('Canonical Claude authentication storage is unavailable or unsafe.');
export const CLAUDE_AUTH_IDENTITY = 'HIVE_MIND_CLAUDE_AUTH_IDENTITY';

export function selectedClaudeAuthHome(env = process.env) {
  if (env.CLAUDE_SECURESTORAGE_CONFIG_DIR === undefined) {
    if (env[CLAUDE_AUTH_IDENTITY] !== undefined) throw refused();
    return null;
  }
  const root = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  if (!absoluteCanonicalStoragePath(root) || root.normalize('NFC') !== root) throw refused();
  return root;
}

export async function readCanonicalClaudeAuth(root, { configurationHome, expectedIdentity } = {}) {
  if (typeof root !== 'string' || typeof configurationHome !== 'string' || root === configurationHome || configurationHome.startsWith(`${root}${path.sep}`)) throw refused();
  // Only the reserved default authority may live inside the configuration home.
  if (root.startsWith(`${configurationHome}${path.sep}`) && !isReservedClaudeAuthority(root, configurationHome)) throw refused();
  return readCanonicalAuthFile(root, { configurationHome, expectedIdentity, filename: '.credentials.json', refused });
}

/** Recheck at each Hive-managed execution attempt, including retries/resumes. */
export async function assertAdmittedClaudeAuth({ env = process.env, homeDir = os.homedir() } = {}) {
  if (env[CLAUDE_AUTH_IDENTITY] === undefined) return;
  const root = selectedClaudeAuthHome(env);
  return readCanonicalClaudeAuth(root, { configurationHome: resolveClaudeConfigDirectory(env, homeDir), expectedIdentity: env[CLAUDE_AUTH_IDENTITY] });
}
