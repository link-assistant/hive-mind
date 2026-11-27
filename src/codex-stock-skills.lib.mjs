/** Verify stock skill files against an independently materialized reference. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// hive-sync-ok: read the bundled manifest once at module startup, before serving requests.
const bundled = JSON.parse(fs.readFileSync(new URL('./codex-stock-skills-0.164.0.json', import.meta.url), 'utf8'));
export const CODEX_STOCK_SKILLS = Object.freeze({ cliVersion: bundled.cliVersion, files: Object.freeze(bundled.files) });
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_STOCK_BYTES = 16 * 1024 * 1024;
const identity = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.nlink}`;
export class CodexStockBaselineError extends Error {
  constructor() {
    super('Codex stock runtime differs from verified pristine stock content. Restore the installed CLI’s stock assets before launch.');
  }
}
const mismatch = () => new CodexStockBaselineError();

export async function validateCodexStockSkills({ directory, fsImpl = fs, manifest = CODEX_STOCK_SKILLS }) {
  return (await scanStockSkills({ directory, fsImpl, manifest })).snapshot;
}

/** Record a reference only from a private home populated by the installed CLI. */
export async function captureCodexStockSkills(directory) {
  const { files, snapshot } = await scanStockSkills({ directory, fsImpl: fs });
  if (snapshot.get(directory) === 'missing' || Object.keys(files).length === 0) throw mismatch();
  return files;
}

export const codexStockSkillsDigest = files =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.keys(files)
          .sort()
          .map(file => [file, files[file]])
      )
    )
    .digest('hex');

export async function validatePreviousCodexStockSkills({ directory, fsImpl, digests }) {
  const { files } = await scanStockSkills({ directory, fsImpl });
  if (!digests.includes(codexStockSkillsDigest(files))) throw mismatch();
  return validateCodexStockSkills({ directory, fsImpl, manifest: { files } });
}

async function scanStockSkills({ directory, fsImpl, manifest }) {
  const io = fsImpl.promises;
  const snapshot = new Map();
  const files = Object.create(null);
  const expected = new Set(Object.keys(manifest?.files ?? {}));
  const directories = new Set();
  for (const file of expected) {
    for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent)) directories.add(parent);
  }
  let entries = 0;
  let totalBytes = 0;
  async function visit(target, relative = '') {
    const info = await io.lstat(target, { bigint: true });
    if (++entries > MAX_ENTRIES || info.isSymbolicLink()) throw mismatch();
    snapshot.set(target, identity(info));
    if (info.isDirectory()) {
      if (manifest && relative && !directories.has(relative)) throw mismatch();
      for await (const entry of await io.opendir(target)) await visit(path.join(target, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
    } else {
      if (!info.isFile() || info.nlink !== 1n || (manifest && !expected.delete(relative)) || info.size > BigInt(MAX_FILE_BYTES)) throw mismatch();
      totalBytes += Number(info.size);
      if (totalBytes > MAX_STOCK_BYTES) throw mismatch();
      const handle = await io.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
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
        const hash = createHash('sha256').update(bytes.subarray(0, offset)).digest('hex');
        if (manifest && hash !== manifest.files[relative]) throw mismatch();
        files[relative] = hash;
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
      return { files, snapshot }; // A fresh CLI has not materialized its stock assets yet.
    }
    await visit(directory);
    if (expected.size) throw mismatch();
    return { files, snapshot };
  } catch {
    throw mismatch();
  }
}
