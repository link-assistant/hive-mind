/** Admit and install the native executable from this package's build outputs. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const bundled = fileURLToPath(new URL('./native-codex/', import.meta.url));
const refusal = () => new Error('The pinned native Codex runtime could not be verified; installation and execution were refused.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = info => `${info.dev}:${info.ino}`;
const revision = info => `${identity(info)}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
const safeName = name => typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.includes('\0') && !path.posix.isAbsolute(name) && name.split('/').every(part => part && part !== '.' && part !== '..');

async function read(file, { max = 4194304, size, digest, metadata = true, executable = false } = {}) {
  const descriptor = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await descriptor.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size <= 0n || before.size > BigInt(max) || (size !== undefined && before.size !== BigInt(size)) || (executable && !(before.mode & 0o111n))) throw refusal();
    const checksum = createHash('sha256');
    const buffer = Buffer.alloc(65536);
    const chunks = [];
    let header;
    let total = 0;
    while (true) {
      const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > max || BigInt(total) > before.size) throw refusal();
      if (!header) header = Buffer.from(buffer.subarray(0, Math.min(64, bytesRead)));
      checksum.update(buffer.subarray(0, bytesRead));
      if (metadata) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const observed = checksum.digest('hex');
    if (BigInt(total) !== before.size || (digest && digest !== observed) || revision(before) !== revision(await descriptor.stat({ bigint: true })) || revision(before) !== revision(await fs.lstat(file, { bigint: true }))) throw refusal();
    return { bytes: metadata ? Buffer.concat(chunks) : undefined, digest: observed, header, size: total };
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

function sourceDigest(files) {
  const sorted = Object.fromEntries(
    Object.keys(files)
      .sort()
      .map(name => [name, { bytes: files[name].bytes, sha256: files[name].sha256 }])
  );
  return hash(Buffer.from(JSON.stringify(sorted)));
}

async function recipe(platform) {
  const selected = `linux-${process.arch}`;
  if (process.platform !== 'linux' || !['linux-x64', 'linux-arm64'].includes(selected) || platform !== selected) throw refusal();
  const input = await read(path.join(bundled, 'recipe.json'));
  const data = JSON.parse(input.bytes);
  if (data.schema !== 1 || data.version !== '0.164.0' || data.profile !== 'release' || !data.targets[platform] || !Number.isSafeInteger(data.maxBinaryBytes) || data.maxBinaryBytes <= 0 || data.maxBinaryBytes > 201326592) throw refusal();
  const files = new Set(['codex', 'manifest.json', 'source.json', 'recipe.json']);
  for (const name of Object.keys(data.licenses)) {
    if (!safeName(name) || !/^[a-f0-9]{64}$/u.test(data.licenses[name])) throw refusal();
    files.add(`licenses/${name}`);
  }
  return { data, digest: input.digest, files, platform };
}

async function entries(root, files) {
  const directories = new Set();
  for (const name of files) {
    let parent = path.posix.dirname(name);
    while (parent !== '.') {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const seen = new Set();
  async function visit(relative = '') {
    const children = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    if (children.length > files.size + directories.size) throw refusal();
    for (const child of children) {
      const name = relative ? `${relative}/${child.name}` : child.name;
      if (child.isDirectory() && directories.has(name)) await visit(name);
      else if (child.isFile() && files.has(name)) seen.add(name);
      else throw refusal();
    }
  }
  await visit();
  if (!isDeepStrictEqual(seen, files)) throw refusal();
}

async function verify(root, prepared, expectedManifest) {
  const rootIdentity = await directory(root);
  await entries(root, prepared.files);
  const manifestInput = await read(path.join(root, 'manifest.json'), { digest: expectedManifest });
  const manifest = JSON.parse(manifestInput.bytes);
  const { data, platform } = prepared;
  const source = JSON.parse((await read(path.join(root, 'source.json'), { digest: manifest.sourceSha256 })).bytes);
  const target = data.targets[platform];
  if (manifest.schema !== 1 || manifest.version !== data.version || manifest.platform !== platform || manifest.target !== target.target || manifest.upstreamCommit !== data.upstreamCommit || manifest.recipeSha256 !== prepared.digest || !isDeepStrictEqual(manifest.cargoEnvironment, data.cargoEnvironment) || !isDeepStrictEqual(manifest.licenses, data.licenses)) throw refusal();
  if (source.schema !== 1 || source.recipeSha256 !== prepared.digest || source.upstreamCommit !== data.upstreamCommit || !isDeepStrictEqual(source.cargoEnvironment, data.cargoEnvironment) || sourceDigest(source.sourceFiles) !== data.sourceInventorySha256 || source.compiler !== manifest.compiler || !source.compiler.startsWith(`rustc ${data.rustToolchain} `) || !source.compiler.split('\n').includes(`host: ${target.target}`)) throw refusal();
  await read(path.join(root, 'recipe.json'), { digest: prepared.digest });
  const binary = manifest.binary;
  if (!binary || !Number.isSafeInteger(binary.bytes) || binary.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(binary.sha256)) throw refusal();
  const inspected = await read(path.join(root, 'codex'), { max: data.maxBinaryBytes, size: binary.bytes, digest: binary.sha256, metadata: false, executable: true });
  const header = inspected.header;
  if (header?.length !== 64 || !header.subarray(0, 7).equals(Buffer.from([127, 69, 76, 70, 2, 1, 1])) || ![2, 3].includes(header.readUInt16LE(16)) || header.readUInt16LE(18) !== target.elfMachine) throw refusal();
  for (const [name, digest] of Object.entries(data.licenses)) await read(path.join(root, 'licenses', name), { digest });
  if ((await directory(root)) !== rootIdentity) throw refusal();
  return { root, entrypoint: path.join(root, 'codex'), version: data.version, platform, manifestSha256: manifestInput.digest };
}

async function bundle(platform) {
  const prepared = await recipe(platform);
  const root = path.join(bundled, 'runtime', platform);
  return { prepared, verified: await verify(root, prepared) };
}

/** The installed generation must match this npm package's admitted manifest. */
export async function verifyNativeCodexRuntime(root, { platform = `linux-${process.arch}` } = {}) {
  try {
    const { prepared, verified } = await bundle(platform);
    const selected = await fs.realpath(root);
    return await verify(selected, prepared, verified.manifestSha256);
  } catch {
    throw refusal();
  }
}

async function copy(source, target, mode, max) {
  const input = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let output;
  try {
    const before = await input.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size <= 0n || before.size > BigInt(max)) throw refusal();
    output = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    const buffer = Buffer.alloc(65536);
    let total = 0;
    while (true) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (BigInt(total) > before.size) throw refusal();
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, null);
        if (!result.bytesWritten) throw refusal();
        written += result.bytesWritten;
      }
    }
    if (BigInt(total) !== before.size || revision(before) !== revision(await input.stat({ bigint: true }))) throw refusal();
    await output.sync();
  } finally {
    await input.close();
    if (output) await output.close();
  }
}

/** Installation owns its package/output directory exclusively. Publish a new
 * private generation only after all copied native bytes and notices verify.
 */
export async function installNativeCodexRuntime({ destination, platform = `linux-${process.arch}` } = {}) {
  let generation;
  let published = false;
  let phase = 'bundled artifact admission';
  try {
    const { prepared, verified } = await bundle(platform);
    phase = 'destination admission';
    if (typeof destination !== 'string' || !path.isAbsolute(destination) || path.normalize(destination) !== destination) throw refusal();
    const parent = path.dirname(destination);
    const parentIdentity = await directory(parent);
    const existing = await fs.lstat(destination).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing) return await verify(await fs.realpath(destination), prepared, verified.manifestSha256);
    generation = await fs.mkdtemp(path.join(parent, '.hive-native-codex-'));
    phase = 'native generation copy';
    for (const name of prepared.files) {
      const target = path.join(generation, name);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await copy(path.join(verified.root, name), target, name === 'codex' ? 0o755 : 0o644, name === 'codex' ? prepared.data.maxBinaryBytes : 4194304);
    }
    phase = 'complete generation admission';
    const installed = await verify(generation, prepared, verified.manifestSha256);
    if ((await directory(parent)) !== parentIdentity) throw refusal();
    phase = 'exclusive generation publication';
    await fs.symlink(path.basename(generation), destination, 'dir');
    published = true;
    return installed;
  } catch {
    if (process.env.HIVE_MIND_NATIVE_CODEX_DEBUG === '1') console.error(`[native-codex] Refused during ${phase}.`);
    throw refusal();
  } finally {
    if (generation && !published)
      await fs.rm(generation, { recursive: true, force: true }).catch(() => {
        throw refusal();
      });
  }
}
