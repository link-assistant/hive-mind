/** Read the selected native credential authority without private-home fallback. */
import { absoluteCanonicalStoragePath, readCanonicalAuthFile } from './canonical-auth-file.lib.mjs';

const refused = () => new Error('Canonical Codex authentication storage is unavailable or unsafe.');

export function selectedCodexAuthHome(env = process.env) {
  if (env.CODEX_AUTH_HOME === undefined) {
    if (env.HIVE_MIND_CODEX_AUTH_IDENTITY !== undefined) throw refused();
    return null;
  }
  const root = env.CODEX_AUTH_HOME;
  if (!absoluteCanonicalStoragePath(root)) throw refused();
  return root;
}

export async function readCanonicalCodexAuth(root, { configurationHome, expectedIdentity } = {}) {
  return readCanonicalAuthFile(root, { configurationHome, expectedIdentity, filename: 'auth.json', refused });
}
