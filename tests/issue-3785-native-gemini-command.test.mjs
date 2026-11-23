/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installNativeGeminiCommand, verifyNativeGeminiCommand } from '../src/native-gemini-command.lib.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-gemini-command-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'upstream');
  const bin = path.join(root, 'bin');
  await fs.mkdir(path.join(source, 'bundle'), { recursive: true });
  await fs.mkdir(bin);
  const ran = path.join(root, 'unexpected-execution');
  const entrypoint = path.join(source, 'bundle/gemini.js');
  await fs.writeFile(entrypoint, `#!/bin/sh\ntouch '${ran}'\necho 0.65.0\n`, { mode: 0o700 });
  const command = path.join(bin, 'gemini');
  await fs.symlink(entrypoint, command);
  return { root, source, command, entrypoint, ran, searchPath: bin };
}

test('a stock command reporting the pinned version cannot pass native package admission', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(verifyNativeGeminiCommand(f), /native Gemini command could not be verified/u);
  await assert.rejects(fs.stat(f.ran), { code: 'ENOENT' });
  assert.equal(await fs.realpath(f.command), f.entrypoint);
});

test('PATH selection admits no unverified command and executes no version probe', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(verifyNativeGeminiCommand({ command: 'gemini', searchPath: f.searchPath }), /execution were refused/u);
  await assert.rejects(fs.stat(f.ran), { code: 'ENOENT' });
});

test('a failed native install preserves the original selected command', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const before = await fs.lstat(f.command);
  await assert.rejects(installNativeGeminiCommand(f), /execution were refused/u);
  assert.equal((await fs.lstat(f.command)).ino, before.ino);
  assert.equal(await fs.realpath(f.command), f.entrypoint);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['bin', 'upstream']);
  await assert.rejects(fs.stat(f.ran), { code: 'ENOENT' });
});

test('activation refuses to replace an ordinary executable file', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await fs.unlink(f.command);
  await fs.copyFile(f.entrypoint, f.command);
  const before = await fs.readFile(f.command);
  await assert.rejects(installNativeGeminiCommand(f), /execution were refused/u);
  assert.deepEqual(await fs.readFile(f.command), before);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['bin', 'upstream']);
});
