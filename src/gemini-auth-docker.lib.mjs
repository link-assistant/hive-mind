/** Project selected Gemini parent directories without sharing configuration. */
import { admitGeminiCanonicalStorage } from './gemini-canonical-storage.lib.mjs';

export const GEMINI_DOCKER_STORAGE_HOMES = Object.freeze({ auth: '/home/box/.hive-mind/canonical/gemini-auth', history: '/home/box/.hive-mind/canonical/gemini-history' });
const refused = () => new Error('Selected native gemini storage cannot be projected into Docker task mounts; refusing credential/history fallback.');

export async function geminiStorageDockerProjection({ tool, env, homeDir, expectedIdentity } = {}) {
  if (tool !== 'gemini') return null;
  try {
    const admitted = await admitGeminiCanonicalStorage({ env, homeDir, expected: expectedIdentity });
    if (!admitted) return null;
    const mounts = [];
    const forwarded = {};
    for (const [kind, { root, identity }] of Object.entries(admitted.selection)) {
      if (/[,:]/u.test(root)) throw refused();
      const target = GEMINI_DOCKER_STORAGE_HOMES[kind];
      mounts.push({ source: root, target });
      forwarded[`GEMINI_${kind.toUpperCase()}_HOME`] = target;
      forwarded[`HIVE_MIND_GEMINI_${kind.toUpperCase()}_IDENTITY`] = identity;
    }
    // Retain original selectors and markers, rather than substituting the
    // derived child markers when subsequent preparation rechecks the parent.
    await admitGeminiCanonicalStorage({ env, homeDir, expected: admitted });
    return { mounts, identity: admitted, env: forwarded };
  } catch {
    throw refused();
  }
}
