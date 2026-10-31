/** Project Claude's independent native secure-storage directory. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_AUTH_IDENTITY, readCanonicalClaudeAuth, selectedClaudeAuthHome } from './claude-canonical-auth.lib.mjs';

export const CLAUDE_DOCKER_AUTH_HOME = '/home/box/.hive-mind/canonical/claude-auth';
const refused = () => new Error('Selected native claude storage cannot be projected into Docker task mounts; refusing credential/history fallback.');
const overlaps = (left, right) => left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);

export async function claudeAuthDockerProjection({ tool, env, homeDir, expectedIdentity } = {}) {
  if (tool !== 'claude') return null;
  try {
    const source = selectedClaudeAuthHome(env);
    if (!source) {
      if (expectedIdentity !== undefined) throw refused();
      return null;
    }
    if (/[,:]/u.test(source)) throw refused();
    const info = await fs.lstat(source, { bigint: true });
    const identity = `${info.dev}:${info.ino}`;
    if (expectedIdentity !== undefined && expectedIdentity !== identity) throw refused();
    if (env[CLAUDE_AUTH_IDENTITY] !== undefined && env[CLAUDE_AUTH_IDENTITY] !== identity) throw refused();
    const roots = new Set([path.join(homeDir, '.claude'), ...(env.CLAUDE_CONFIG_DIR !== undefined ? [env.CLAUDE_CONFIG_DIR] : [])]);
    for (const configurationHome of roots) {
      if (typeof configurationHome !== 'string' || !path.isAbsolute(configurationHome) || path.normalize(configurationHome) !== configurationHome || configurationHome.normalize('NFC') !== configurationHome || overlaps(source, configurationHome)) throw refused();
      await readCanonicalClaudeAuth(source, { configurationHome, expectedIdentity: identity });
    }
    return { mount: { source, target: CLAUDE_DOCKER_AUTH_HOME }, identity, env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: CLAUDE_DOCKER_AUTH_HOME, [CLAUDE_AUTH_IDENTITY]: identity } };
  } catch {
    throw refused();
  }
}
