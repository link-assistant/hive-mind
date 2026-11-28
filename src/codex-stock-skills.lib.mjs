/** Verify installed stock files against a pristine pinned CLI, issue #3785. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// hive-sync-ok: read the bundled manifests at module startup, before serving requests.
const bundled = JSON.parse(fs.readFileSync(new URL('./codex-stock-skills-0.172.0.json', import.meta.url), 'utf8'));
// An upgraded CLI rematerializes a pristine previous system tree on first start.
// hive-sync-ok: read the previous bundled manifest at module startup.
const previous = JSON.parse(fs.readFileSync(new URL('./codex-stock-skills-0.164.0.json', import.meta.url), 'utf8'));
export const CODEX_STOCK_SKILLS = Object.freeze({ cliVersion: bundled.cliVersion, files: Object.freeze(bundled.files) });
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 10_000;
const identity = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.nlink}`;
export class CodexStockBaselineError extends Error {
  constructor() {
    super('Codex stock runtime differs from the verified baseline. Restore verified stock content before launch; no repair is permitted.');
  }
}
const mismatch = () => new CodexStockBaselineError();

async function inspectStock({ directory, fsImpl, manifest }) {
  const io = fsImpl.promises;
  const snapshot = new Map();
  const files = Object.create(null);
  const expected = manifest ? new Set(Object.keys(manifest.files)) : null;
  const directories = new Set(manifest?.directories);
  for (const file of expected ?? []) {
    for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent)) directories.add(parent);
  }
  let entries = 0;
  async function visit(target, relative = '') {
    const info = await io.lstat(target, { bigint: true });
    if (++entries > MAX_ENTRIES || info.isSymbolicLink()) throw mismatch();
    snapshot.set(target, identity(info));
    if (info.isDirectory()) {
      if (relative && expected && !directories.has(relative)) throw mismatch();
      if (relative && !expected) directories.add(relative);
      for await (const entry of await io.opendir(target)) await visit(path.join(target, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
    } else {
      if (!relative || !info.isFile() || info.nlink !== 1n || (expected && !expected.delete(relative)) || info.size > BigInt(MAX_FILE_BYTES)) throw mismatch();
      const handle = await io.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        if (identity(await handle.stat({ bigint: true })) !== identity(info)) throw mismatch();
        // Bound allocation and reads even if the file grows after lstat.
        const bytes = Buffer.alloc(Number(info.size) + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset !== Number(info.size) || identity(await handle.stat({ bigint: true })) !== identity(info)) throw mismatch();
        const digest = createHash('sha256').update(bytes.subarray(0, offset)).digest('hex');
        if (manifest && digest !== manifest.files[relative]) throw mismatch();
        files[relative] = digest;
      } finally {
        await handle.close();
      }
    }
    if (identity(await io.lstat(target, { bigint: true })) !== identity(info)) throw mismatch();
  }
  try {
    try {
      await io.lstat(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      snapshot.set(directory, 'missing');
      return { snapshot, files, directories }; // A fresh CLI has not materialized its stock assets yet.
    }
    await visit(directory);
    if (expected?.size || manifest?.directories?.some(relative => !snapshot.has(path.join(directory, relative)))) throw mismatch();
    return { snapshot, files, directories };
  } catch {
    throw mismatch();
  }
}

/** Verify bytes and retain identities for the audit's concurrent-edit guard. */
export async function validateCodexStockSkills({ directory, fsImpl = fs, manifest, allowPrevious = false }) {
  const { snapshot } = await inspectStock({ directory, fsImpl, manifest: manifest ?? CODEX_STOCK_SKILLS }).catch(error => {
    if (manifest || !allowPrevious || !(error instanceof CodexStockBaselineError)) throw error;
    return inspectStock({ directory, fsImpl, manifest: previous });
  });
  return snapshot;
}

/** Only call on the disposable tree just produced by the selected stock CLI. */
export async function captureCodexStockSkills({ directory }) {
  if ((await fs.promises.realpath(directory).catch(() => null)) !== directory) throw mismatch();
  const { files, snapshot, directories } = await inspectStock({ directory, fsImpl: fs });
  if (snapshot.get(directory) === 'missing') throw mismatch();
  return { files, directories: [...directories] };
}
