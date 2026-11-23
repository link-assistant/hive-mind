/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { installImageRipgrep } from '../scripts/install-image-ripgrep.mjs';

const execute = promisify(execFile);
async function fixture(t, { arch = 'x64', version = '0.164.0', platformVersion = `0.164.0-linux-${arch}`, body = '#!/bin/sh\nprintf "ripgrep 14.1.1\\n"\n' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-image-rg-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexRoot = path.join(root, 'node_modules/@openai/codex');
  const platformRoot = path.join(root, `node_modules/@openai/codex-linux-${arch}`);
  const source = path.join(platformRoot, `vendor/${arch === 'x64' ? 'x86_64' : 'aarch64'}-unknown-linux-musl/codex-path/rg`);
  await fs.mkdir(codexRoot, { recursive: true });
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(path.join(codexRoot, 'package.json'), JSON.stringify({ version }));
  await fs.writeFile(path.join(platformRoot, 'package.json'), JSON.stringify({ version: platformVersion }));
  await fs.writeFile(source, body, { mode: 0o644 });
  return { codexRoot, source, destination: path.join(root, 'bin/rg'), arch };
}

for (const arch of ['x64', 'arm64']) {
  test(`install architecture-matched ${arch} search outside shared tool data`, { timeout: 5000 }, async t => {
    const f = await fixture(t, { arch });
    const original = await fs.readFile(f.source);
    await installImageRipgrep(f);
    assert.deepEqual(await fs.readFile(f.destination), original);
    assert.equal((await fs.stat(f.destination)).mode & 0o777, 0o755);
    assert.equal((await execute(f.destination, ['--version'])).stdout.trim(), 'ripgrep 14.1.1');
    assert.equal((await fs.stat(f.source)).mode & 0o777, 0o644, 'do not mutate the pinned package');
  });
}

for (const options of [{ version: '0.163.0' }, { platformVersion: '0.163.0-linux-x64' }, { body: '#!/bin/sh\nexit 1\n' }, { body: '#!/bin/sh\nprintf "unrelated command\\n"\n' }]) {
  test(`bad search installation preserves the previous executable: ${JSON.stringify(options)}`, { timeout: 5000 }, async t => {
    const f = await fixture(t, options);
    await fs.mkdir(path.dirname(f.destination));
    await fs.writeFile(f.destination, 'previous-executable');
    await assert.rejects(installImageRipgrep(f));
    assert.equal(await fs.readFile(f.destination, 'utf8'), 'previous-executable');
    assert.deepEqual(await fs.readdir(path.dirname(f.destination)), ['rg'], 'remove incomplete staging files');
  });
}

test('a linked installation destination cannot overwrite protected state', async t => {
  const f = await fixture(t);
  const protectedFile = path.join(path.dirname(f.codexRoot), 'protected');
  await fs.writeFile(protectedFile, 'unchanged');
  await fs.mkdir(path.dirname(f.destination));
  await fs.symlink(protectedFile, f.destination);
  await assert.rejects(installImageRipgrep(f));
  assert.equal(await fs.readFile(protectedFile, 'utf8'), 'unchanged');
});

for (const image of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
  test(`${image} installs and exposes the pinned image search command`, async () => {
    const source = await fs.readFile(new URL(`../${image}`, import.meta.url), 'utf8');
    assert.match(source, /node \/tmp\/hive-mind-source\/scripts\/install-image-ripgrep\.mjs\s*\\\n\s*\/home\/box\/\.bun\/install\/global\/node_modules\/@openai\/codex \/home\/box\/\.local\/bin\/rg/u);
    assert.match(source, /ENV PATH="[^"\n]*\/home\/box\/\.local\/bin/u);
  });
}
