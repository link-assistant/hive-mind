/** Install the exact native Gemini adapter into a separate verified generation. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const recipeRoot = fileURLToPath(new URL('./native-gemini/recipe/', import.meta.url));
const marker = '.hive-native-package.json';
const refusal = () => new Error('The pinned native Gemini package could not be verified; installation and execution were refused.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = info => `${info.dev}:${info.ino}`;
const revision = info => `${identity(info)}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
const trace = phase => {
  if (process.env.HIVE_MIND_NATIVE_GEMINI_DEBUG === '1') console.error(`[native-gemini] Refused during ${phase}.`);
};
const safeName = name => typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.includes('\0') && !path.posix.isAbsolute(name) && name.split('/').every(part => part && part !== '.' && part !== '..');

async function regularFile(file, { size, digest } = {}) {
  const descriptor = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await descriptor.stat({ bigint: true });
    if (!before.isFile() || before.size > 67108864n || (size !== undefined && before.size !== BigInt(size))) throw refusal();
    const bytes = await descriptor.readFile();
    const after = await descriptor.stat({ bigint: true });
    if (revision(before) !== revision(after) || (digest && hash(bytes) !== digest)) throw refusal();
    return bytes;
  } finally {
    await descriptor.close();
  }
}

async function directory(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root || (await fs.realpath(root)) !== root) throw refusal();
  const info = await fs.lstat(root, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) throw refusal();
  return identity(info);
}

async function recipe() {
  const manifest = JSON.parse(await regularFile(path.join(recipeRoot, 'manifest.json')));
  if (manifest.schema !== 1 || manifest.name !== '@google/gemini-cli' || manifest.version !== '0.65.0') throw refusal();
  const inventory = JSON.parse(await regularFile(path.join(recipeRoot, 'upstream.json'), { digest: manifest.inventorySha256 }));
  const files = new Map();
  for (const [name, entry] of Object.entries(inventory)) {
    const match = /^([a-f0-9]{64}):(\d+):(\d+)$/u.exec(entry);
    if (!safeName(name) || !match) throw refusal();
    files.set(name, { digest: match[1], size: Number(match[2]), mode: Number(match[3]) });
  }
  const patches = new Map();
  for (const [name, entry] of Object.entries(manifest.patches)) {
    if (!safeName(name) || !name.startsWith('bundle/') || !safeName(entry.payload) || entry.payload.includes('/') || !/^[a-f0-9]{64}$/u.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 67108864) throw refusal();
    const payload = JSON.parse(await regularFile(path.join(recipeRoot, entry.payload), { digest: entry.payloadSha256 }));
    patches.set(name, { ...entry, payload });
  }
  return { manifest, files, patches };
}

function patched(bytes, payload) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes) || !Array.isArray(payload.edits)) throw refusal();
  const lines = text.match(/[^\n]*\n|[^\n]+$/gu) || [];
  let boundary = lines.length;
  for (const edit of [...payload.edits].reverse()) {
    if (!Number.isSafeInteger(edit.at) || edit.at < 0 || !Array.isArray(edit.remove) || !Array.isArray(edit.insert) || edit.at + edit.remove.length > boundary || [...edit.remove, ...edit.insert].some(line => typeof line !== 'string' || !line.endsWith('\n'))) throw refusal();
    if (lines.slice(edit.at, edit.at + edit.remove.length).join('') !== edit.remove.join('')) throw refusal();
    lines.splice(edit.at, edit.remove.length, ...edit.insert);
    boundary = edit.at;
  }
  return Buffer.from(lines.join(''));
}

function outputBytes(before, patch) {
  if (!patch) return before;
  const { payload } = patch;
  let bytes;
  if (before) {
    bytes = patched(before, payload);
  } else {
    if (!Array.isArray(payload.lines) || payload.lines.some(line => typeof line !== 'string')) throw refusal();
    bytes = Buffer.from(payload.lines.join(''));
  }
  if (bytes.length !== patch.size || hash(bytes) !== patch.sha256) throw refusal();
  return bytes;
}

async function write(file, bytes, mode) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  const descriptor = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    await descriptor.writeFile(bytes);
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
}

async function dependencies(root, expected) {
  const link = path.join(root, 'node_modules');
  if (!expected) {
    if (
      await fs.lstat(link).then(
        () => true,
        error => (error.code === 'ENOENT' ? false : Promise.reject(error))
      )
    )
      throw refusal();
    return;
  }
  if ((await fs.readlink(link)) !== expected.path || (await directory(expected.path)) !== expected.identity) throw refusal();
}

async function entries(root, prepared, nested) {
  const files = new Set([...prepared.files.keys(), ...prepared.patches.keys(), marker]);
  const directories = new Set();
  for (const name of files) {
    let parent = path.posix.dirname(name);
    while (parent !== '.') {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  async function visit(relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && name === 'node_modules' && nested && entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && directories.has(name)) await visit(name);
      else if (!entry.isFile() || !files.has(name)) throw refusal();
    }
  }
  await visit();
}

async function verify(root, prepared) {
  const selected = await fs.realpath(root);
  const rootIdentity = await directory(selected);
  const ready = JSON.parse(await regularFile(path.join(selected, marker)));
  if (ready.schema !== 1 || ready.version !== prepared.manifest.version) throw refusal();
  await entries(selected, prepared, ready.dependencies);
  for (const [name, original] of prepared.files) {
    const patch = prepared.patches.get(name);
    await regularFile(path.join(selected, name), { size: patch?.size ?? original.size, digest: patch?.sha256 ?? original.digest });
  }
  for (const [name, patch] of prepared.patches) {
    if (!prepared.files.has(name)) await regularFile(path.join(selected, name), { size: patch.size, digest: patch.sha256 });
  }
  await dependencies(selected, ready.dependencies);
  if ((await directory(selected)) !== rootIdentity || (await fs.realpath(root)) !== selected) throw refusal();
  return { root: selected, version: prepared.manifest.version, entrypoint: path.join(selected, 'bundle/gemini.js') };
}

/** Verify executable bytes separately from authentication/history admission. */
export async function verifyNativeGemini(root) {
  try {
    return await verify(root, await recipe());
  } catch {
    throw refusal();
  }
}

/** Publish an exclusive symlink only after every native file has been verified.
 * Keep the source package and its nested optional dependencies untouched.
 * Sibling placement retains npm's ordinary flattened dependency resolution.
 */
export async function installNativeGemini({ source, destination } = {}) {
  let generation;
  let published = false;
  let phase = 'bundled recipe verification';
  try {
    const prepared = await recipe();
    phase = 'source directory verification';
    const sourceIdentity = await directory(source);
    phase = 'destination verification';
    if (typeof destination !== 'string' || !path.isAbsolute(destination) || path.normalize(destination) !== destination || path.dirname(source) !== path.dirname(destination) || source === destination) throw refusal();
    const parent = path.dirname(destination);
    const parentIdentity = await directory(parent);
    const existing = await fs.lstat(destination).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing) return await verify(destination, prepared);
    generation = await fs.mkdtemp(path.join(parent, '.hive-native-gemini-'));
    const ready = { schema: 1, version: prepared.manifest.version };
    for (const [name, entry] of prepared.files) {
      phase = `pinned input ${JSON.stringify(name)}`;
      if ((await directory(source)) !== sourceIdentity) throw refusal();
      const input = await regularFile(path.join(source, name), entry);
      const bytes = outputBytes(input, prepared.patches.get(name));
      await write(path.join(generation, name), bytes, entry.mode);
    }
    for (const [name, patch] of prepared.patches) {
      if (prepared.files.has(name)) continue;
      phase = `native helper ${JSON.stringify(name)}`;
      // An injected helper in the stock source is not an approved input.
      if (
        await fs.lstat(path.join(source, name)).then(
          () => true,
          error => (error.code === 'ENOENT' ? false : Promise.reject(error))
        )
      )
        throw refusal();
      await write(path.join(generation, name), outputBytes(null, patch), 0o644);
    }
    phase = 'optional dependency directory verification';
    const nested = path.join(source, 'node_modules');
    const nestedInfo = await fs.lstat(nested).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (nestedInfo) {
      ready.dependencies = { path: nested, identity: await directory(nested) };
      await fs.symlink(nested, path.join(generation, 'node_modules'), 'dir');
    }
    if ((await directory(source)) !== sourceIdentity || (await directory(parent)) !== parentIdentity) throw refusal();
    await write(path.join(generation, marker), Buffer.from(JSON.stringify(ready) + '\n'), 0o600);
    phase = 'complete native generation verification';
    const verified = await verify(generation, prepared);
    phase = 'exclusive generation publication';
    await fs.symlink(path.basename(generation), destination, 'dir');
    published = true;
    return verified;
  } catch {
    trace(phase);
    throw refusal();
  } finally {
    if (generation && !published)
      await fs.rm(generation, { recursive: true, force: true }).catch(() => {
        throw refusal();
      });
  }
}
