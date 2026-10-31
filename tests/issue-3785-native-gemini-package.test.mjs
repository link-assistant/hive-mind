/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installNativeGemini, verifyNativeGemini } from '../src/native-gemini-package.lib.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-gemini-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'upstream');
  const destination = path.join(root, 'native');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'package.json'), '{"name":"@google/gemini-cli","version":"0.65.0"}\n');
  return { root, source, destination };
}

test('a version label cannot admit an incomplete native executable package', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.source, 'package.json'));
  await assert.rejects(installNativeGemini(f), /pinned native Gemini package could not be verified/u);
  assert.deepEqual(await fs.readFile(path.join(f.source, 'package.json')), before);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['upstream']);
});

test('a source directory alias cannot redirect native package installation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'alias');
  await fs.symlink(f.source, alias, 'dir');
  await assert.rejects(installNativeGemini({ source: alias, destination: f.destination }), /execution were refused/u);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['alias', 'upstream']);
});

test('destination collisions preserve an existing executable and expose no native generation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await fs.writeFile(f.destination, 'synthetic existing executable\n', { mode: 0o700 });
  const before = await fs.stat(f.destination);
  await assert.rejects(installNativeGemini(f), /execution were refused/u);
  assert.equal(await fs.readFile(f.destination, 'utf8'), 'synthetic existing executable\n');
  assert.equal((await fs.stat(f.destination)).ino, before.ino);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['native', 'upstream']);
});

test('a ready marker without the complete pinned executable refuses verification', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, '.hive-native-package.json'), '{"schema":1,"version":"0.65.0"}\n');
  await assert.rejects(verifyNativeGemini(f.source), error => /execution were refused/u.test(error.message) && !error.message.includes(f.root));
});
