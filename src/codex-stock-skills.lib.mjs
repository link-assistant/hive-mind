/** Verify installed stock files against a pristine pinned CLI, issue #3785. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// hive-sync-ok: read the bundled manifest once at module startup, before serving requests.
const bundled = JSON.parse(fs.readFileSync(new URL('./codex-stock-skills-0.164.0.json', import.meta.url), 'utf8'));
export const CODEX_STOCK_SKILLS = Object.freeze({ cliVersion: bundled.cliVersion, files: Object.freeze(bundled.files) });
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 10_000;
const identity = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.nlink}`;
export class CodexStockBaselineError extends Error {
  constructor() {
    super('Codex stock runtime differs from the pristine pinned CLI 0.164.0 baseline. Restore verified stock content before launch; no repair is permitted.');
  }
}
const mismatch = () => new CodexStockBaselineError();

/** No installed skill code is executed or logged. The manifest parameter is for
 * isolated tests; production admission always uses the bundled pinned manifest.
 * The returned identities participate in the existing concurrent-edit guard.
 */
export async function validateCodexStockSkills({ directory, fsImpl = fs, manifest = CODEX_STOCK_SKILLS }) {
  const io = fsImpl.promises;
  const snapshot = new Map();
  const expected = new Set(Object.keys(manifest.files));
  const directories = new Set();
  for (const file of expected) {
    for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent)) directories.add(parent);
  }
  let entries = 0;
  async function visit(target, relative = '') {
    const info = await io.lstat(target, { bigint: true });
    if (++entries > MAX_ENTRIES || info.isSymbolicLink()) throw mismatch();
    snapshot.set(target, identity(info));
    if (info.isDirectory()) {
      if (relative && !directories.has(relative)) throw mismatch();
      for await (const entry of await io.opendir(target)) await visit(path.join(target, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
    } else {
      if (!info.isFile() || info.nlink !== 1n || !expected.delete(relative) || info.size > BigInt(MAX_FILE_BYTES)) throw mismatch();
      const handle = await io.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        if (identity(await handle.stat({ bigint: true })) !== identity(info)) throw mismatch();
        // Bound allocation and reads even if the file grows after lstat.
        const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset > MAX_FILE_BYTES || identity(await handle.stat({ bigint: true })) !== identity(info)) throw mismatch();
        if (createHash('sha256').update(bytes.subarray(0, offset)).digest('hex') !== manifest.files[relative]) throw mismatch();
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
      return snapshot; // A fresh CLI has not materialized its stock assets yet.
    }
    await visit(directory);
    if (expected.size) throw mismatch();
    return snapshot;
  } catch {
    throw mismatch();
  }
}
