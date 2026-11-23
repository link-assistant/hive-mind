/** Bind the selected credential parent so native rename/logout stay shared. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readCanonicalCodexAuth, selectedCodexAuthHome } from './codex-canonical-auth.lib.mjs';

export const CODEX_DOCKER_AUTH_HOME = '/home/box/.hive-mind/canonical/codex-auth';
const refused = () => new Error('Selected native codex storage cannot be projected into Docker task mounts; refusing credential/history fallback.');
const overlaps = (left, right) => left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);

export async function codexAuthDockerProjection({ tool, env, homeDir, expectedIdentity } = {}) {
  if (tool !== 'codex') return null;
  try {
    const source = selectedCodexAuthHome(env);
    if (!source) {
      if (expectedIdentity !== undefined) throw refused();
      return null;
    }
    if (/[,:]/u.test(source)) throw refused();
    const info = await fs.lstat(source, { bigint: true });
    const identity = `${info.dev}:${info.ino}`;
    if (expectedIdentity !== undefined && expectedIdentity !== identity) throw refused();
    if (env.HIVE_MIND_CODEX_AUTH_IDENTITY !== undefined && env.HIVE_MIND_CODEX_AUTH_IDENTITY !== identity) throw refused();
    const roots = new Set([path.join(homeDir, '.codex'), ...(env.CODEX_HOME !== undefined ? [env.CODEX_HOME] : []), ...(env.HIVE_MIND_PARENT_CODEX_HOME !== undefined ? [env.HIVE_MIND_PARENT_CODEX_HOME] : [])]);
    for (const configurationHome of roots) {
      // A task receives the dedicated authority, never the operator's entire
      // application/configuration directory or a directory disposable with it.
      if (typeof configurationHome !== 'string' || !path.isAbsolute(configurationHome) || path.normalize(configurationHome) !== configurationHome || overlaps(source, configurationHome)) throw refused();
      await readCanonicalCodexAuth(source, { configurationHome, expectedIdentity: identity });
    }
    return { mount: { source, target: CODEX_DOCKER_AUTH_HOME }, identity, env: { CODEX_AUTH_HOME: CODEX_DOCKER_AUTH_HOME, HIVE_MIND_CODEX_AUTH_IDENTITY: identity } };
  } catch {
    throw refused();
  }
}
