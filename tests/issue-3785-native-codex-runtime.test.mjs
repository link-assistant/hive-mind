/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { installNativeCodexRuntime, verifyNativeCodexRuntime } from '../src/native-codex-runtime.lib.mjs';

const supported = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch);

async function packagingFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-codex-identity-fixture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const src = path.join(root, 'src');
  const platform = `linux-${process.arch}`;
  const native = path.join(src, 'native-codex');
  const runtime = path.join(native, 'runtime', platform);
  await fs.mkdir(path.join(runtime, 'licenses'), { recursive: true });
  await fs.copyFile(new URL('../src/native-codex-runtime.lib.mjs', import.meta.url), path.join(src, 'native-codex-runtime.lib.mjs'));
  const recipe = JSON.parse(await fs.readFile(new URL('../src/native-codex/recipe.json', import.meta.url), 'utf8'));
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const license = Buffer.from('Synthetic packaging fixture license, not upstream license text.\n');
  recipe.licenses = { LICENSE: sha256(license) };
  const recipeBytes = Buffer.from(JSON.stringify(recipe));
  const recipeSha256 = sha256(recipeBytes);
  await fs.writeFile(path.join(native, 'recipe.json'), recipeBytes);
  await fs.writeFile(path.join(runtime, 'recipe.json'), recipeBytes);
  await fs.writeFile(path.join(runtime, 'licenses/LICENSE'), license);
  // This ELF-shaped identity fixture is never executed. Full actual CLI
  // behavior is checked separately using the compiled installed npm artifact.
  const binary = Buffer.alloc(128);
  binary.set([127, 69, 76, 70, 2, 1, 1]);
  binary.writeUInt16LE(3, 16);
  binary.writeUInt16LE(recipe.targets[platform].elfMachine, 18);
  await fs.writeFile(path.join(runtime, 'codex'), binary, { mode: 0o755 });
  const compiler = `rustc ${recipe.rustToolchain} (synthetic packaging fixture)\nhost: ${recipe.targets[platform].target}\n`;
  const source = Buffer.from(JSON.stringify({ schema: 1, recipeSha256, upstreamCommit: recipe.upstreamCommit, compiler, cargoEnvironment: recipe.cargoEnvironment, sourceFiles: JSON.parse(await fs.readFile(new URL('../src/native-codex/source-files.json', import.meta.url), 'utf8')) }));
  await fs.writeFile(path.join(runtime, 'source.json'), source);
  await fs.writeFile(path.join(runtime, 'manifest.json'), JSON.stringify({ schema: 1, platform, target: recipe.targets[platform].target, version: recipe.version, upstreamCommit: recipe.upstreamCommit, recipeSha256, sourceSha256: sha256(source), compiler, cargoEnvironment: recipe.cargoEnvironment, licenses: recipe.licenses, binary: { sha256: sha256(binary), bytes: binary.length } }));
  const api = await import(pathToFileURL(path.join(src, 'native-codex-runtime.lib.mjs')));
  return { root, runtime, api, destination: path.join(root, 'native') };
}

test('a native version label without the bundled executable cannot admit a runtime', { timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-codex-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'manifest.json'), '{"schema":1,"version":"0.164.0"}\n');
  await assert.rejects(verifyNativeCodexRuntime(root), error => /installation and execution were refused/u.test(error.message) && !error.message.includes(root));
});

test('missing native package bytes preserve an existing destination', { timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-codex-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'native');
  await fs.writeFile(destination, 'existing executable\n', { mode: 0o700 });
  const before = await fs.stat(destination);
  await assert.rejects(installNativeCodexRuntime({ destination }), /execution were refused/u);
  assert.equal(await fs.readFile(destination, 'utf8'), 'existing executable\n');
  assert.equal((await fs.stat(destination)).ino, before.ino);
  assert.deepEqual(await fs.readdir(root), ['native']);
});

test('unsupported native platforms refuse without creating installation state', { timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-codex-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(installNativeCodexRuntime({ destination: path.join(root, 'native'), platform: 'linux-unsupported' }), /execution were refused/u);
  assert.deepEqual(await fs.readdir(root), []);
});

test('complete packaging identities publish one verified idempotent generation', { timeout: 10000, skip: !supported }, async t => {
  const f = await packagingFixture(t);
  const ready = await f.api.installNativeCodexRuntime({ destination: f.destination });
  const published = await fs.lstat(f.destination);
  assert.equal((await f.api.verifyNativeCodexRuntime(f.destination)).entrypoint, ready.entrypoint);
  assert.equal((await f.api.installNativeCodexRuntime({ destination: f.destination })).entrypoint, ready.entrypoint);
  assert.equal((await fs.lstat(f.destination)).ino, published.ino);
  assert.equal((await fs.readdir(f.root)).filter(name => name.startsWith('.hive-native-codex-')).length, 1);
});

test('changed native generation and alias payload refuse while source stays healthy', { timeout: 10000, skip: !supported }, async t => {
  const f = await packagingFixture(t);
  const ready = await f.api.installNativeCodexRuntime({ destination: f.destination });
  await fs.appendFile(ready.entrypoint, 'changed');
  await assert.rejects(f.api.verifyNativeCodexRuntime(f.destination), /execution were refused/u);
  await assert.rejects(f.api.installNativeCodexRuntime({ destination: f.destination }), /execution were refused/u);
  const manifest = path.join(f.runtime, 'manifest.json');
  await fs.rename(manifest, `${manifest}.saved`);
  await fs.symlink('manifest.json.saved', manifest);
  await assert.rejects(f.api.installNativeCodexRuntime({ destination: path.join(f.root, 'refused') }), /execution were refused/u);
  await assert.rejects(fs.access(path.join(f.root, 'refused')), { code: 'ENOENT' });
});

test('a bundled runtime directory alias refuses before publishing a generation', { timeout: 10000, skip: !supported }, async t => {
  const f = await packagingFixture(t);
  await fs.rename(f.runtime, `${f.runtime}.saved`);
  await fs.symlink(path.basename(`${f.runtime}.saved`), f.runtime, 'dir');
  await assert.rejects(f.api.installNativeCodexRuntime({ destination: f.destination }), /execution were refused/u);
  await assert.rejects(fs.access(f.destination), { code: 'ENOENT' });
  assert.equal(
    (await fs.readdir(f.root)).some(name => name.startsWith('.hive-native-codex-')),
    false
  );
});
