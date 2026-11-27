/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nativeCodexPackagingFixture as packagingFixture } from './helpers/native-codex-fixture.mjs';
import { installNativeCodexRuntime, verifyNativeCodexRuntime } from '../src/native-codex-runtime.lib.mjs';

const supported = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch);

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

test('a missing or corrupt stock host prevents native runtime publication', { timeout: 10000, skip: !supported }, async t => {
  const f = await packagingFixture(t);
  const host = await fs.readFile(f.stockHost);
  await fs.unlink(f.stockHost);
  await assert.rejects(f.api.installNativeCodexRuntime({ destination: f.destination }), /execution were refused/u);
  host[64] ^= 255;
  await fs.writeFile(f.stockHost, host, { mode: 0o755 });
  await assert.rejects(f.api.installNativeCodexRuntime({ destination: f.destination }), /execution were refused/u);
  assert.equal(
    (await fs.readdir(f.root)).some(name => name.startsWith('.hive-native-codex-')),
    false
  );
  await assert.rejects(fs.lstat(f.destination), { code: 'ENOENT' });
});

test('installed verification requires an executable, intact sibling even if the stock host is healthy', { timeout: 10000, skip: !supported }, async t => {
  const f = await packagingFixture(t);
  const ready = await f.api.installNativeCodexRuntime({ destination: f.destination });
  const host = path.join(path.dirname(ready.entrypoint), 'codex-code-mode-host');
  assert.deepEqual(await fs.readFile(host), await fs.readFile(f.stockHost));
  assert.notEqual((await fs.stat(host)).ino, (await fs.stat(f.stockHost)).ino);
  await fs.chmod(host, 0o644);
  await assert.rejects(f.api.verifyNativeCodexRuntime(f.destination), /execution were refused/u);
  await fs.unlink(host);
  await assert.rejects(f.api.verifyNativeCodexRuntime(f.destination), /execution were refused/u);
  await fs.symlink(f.stockHost, host);
  await assert.rejects(f.api.verifyNativeCodexRuntime(f.destination), /execution were refused/u);
});

test('observed optimized native size installs and verifies with bounded reads', { timeout: 45000, skip: !supported }, async t => {
  // The optimized x64 output from run 41189998708 is this large. Synthetic
  // sparse bytes verify actual package installation; they are never executed.
  const binaryBytes = 350950272;
  const f = await packagingFixture(t, { binaryBytes });
  const ready = await f.api.installNativeCodexRuntime({ destination: f.destination });
  assert.equal((await fs.stat(ready.entrypoint)).size, binaryBytes);
  assert.equal((await f.api.verifyNativeCodexRuntime(f.destination)).entrypoint, ready.entrypoint);
  assert.equal((await fs.stat(ready.entrypoint)).nlink, 1);
  assert.notEqual((await fs.stat(ready.entrypoint)).ino, (await fs.stat(path.join(f.runtime, 'codex'))).ino);
});

test('an artifact cannot raise the installer binary size ceiling', { timeout: 10000, skip: !supported }, async t => {
  const f = await packagingFixture(t, { maxBinaryBytes: 402653185 });
  await assert.rejects(f.api.installNativeCodexRuntime({ destination: f.destination }), /execution were refused/u);
  await assert.rejects(fs.lstat(f.destination), { code: 'ENOENT' });
  assert.equal(
    (await fs.readdir(f.root)).some(name => name.startsWith('.hive-native-codex-')),
    false
  );
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
