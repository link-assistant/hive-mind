/** Disposable Codex configuration and discovery roots, separate from shared state. */
import fs from 'node:fs/promises';
import path from 'node:path';

const sanitizePathSegment = value =>
  String(value || '')
    .replace(/[^a-zA-Z0-9._-]/gu, '_')
    .replace(/^\.+$/u, '_');

// Historical location used only when recovering rollouts from old containers.
export function buildCodexCapabilityStatePath({ baseCodexHome, owner, repo }) {
  return path.join(baseCodexHome, 'hive-mind', 'repositories', sanitizePathSegment(owner), sanitizePathSegment(repo));
}

// This is an allocation namespace, never a reusable CODEX_HOME.
export function buildCodexTaskScopeNamespace({ baseCodexHome, owner, repo }) {
  return path.join(path.dirname(baseCodexHome), '.hive-mind', 'codex-tasks', sanitizePathSegment(owner), sanitizePathSegment(repo));
}

const unsafeNamespace = () => new Error('Cannot establish a Codex task scope through unsafe directories.');

async function prepareNamespace(namespace) {
  if (!path.isAbsolute(namespace) || path.normalize(namespace) !== namespace) throw unsafeNamespace();
  let current = path.parse(namespace).root;
  for (const segment of namespace.slice(current.length).split(path.sep)) {
    current = path.join(current, segment);
    let stat = await fs.lstat(current).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) {
      await fs.mkdir(current, { mode: 0o700 }).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
      stat = await fs.lstat(current);
    }
    if (!stat.isDirectory()) throw unsafeNamespace();
  }
}

export function createCodexTaskScopeAllocator() {
  const scopes = [];
  return {
    createScope: async options => {
      const namespace = buildCodexTaskScopeNamespace(options);
      await prepareNamespace(namespace);
      const codexHome = await fs.mkdtemp(path.join(namespace, 'run-'));
      scopes.push({ codexHome, identity: await fs.lstat(codexHome) });
      return codexHome;
    },
    dispose: async () => {
      for (const { codexHome, identity } of scopes) {
        const current = await fs.lstat(codexHome).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!current) continue;
        if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Refusing to remove a replaced Codex task scope.');
        // fs.rm removes session links themselves, never their shared targets.
        await fs.rm(codexHome, { recursive: true, force: true });
      }
    },
  };
}
