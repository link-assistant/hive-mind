// @hive-mind-test-suite default
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configureFormalAiClientHome, seedFormalAiClientHome } from '../src/formal-ai-runtime.lib.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'formal-ai-codex-authority-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const canonical = path.join(root, 'canonical');
  const configuration = path.join(root, 'configuration');
  for (const directory of [canonical, configuration]) await fs.mkdir(directory, { mode: 0o700 });
  const auth = path.join(canonical, 'auth.json');
  await fs.writeFile(auth, '{"tokens":{"access_token":"synthetic-canonical"}}', { mode: 0o600 });
  const config = '[features]\nremote_plugin=false\n[mcp_servers.operator]\ncommand="synthetic"\n';
  await fs.writeFile(path.join(configuration, 'config.toml'), config);
  const home = path.join(root, 'task');
  const destination = path.join(home, '.codex');
  const copied = [];
  const options = {
    client: { id: 'codex', global_configs: [{ format: 'toml', path: '.codex/config.toml' }] },
    home,
    env: { CODEX_HOME: configuration, CODEX_AUTH_HOME: canonical },
    cpImpl: async (...args) => {
      copied.push(args);
      return fs.cp(...args);
    },
  };
  return { root, canonical, configuration, auth, destination, copied, options };
}

test('Formal AI seeds selected Codex configuration without credential snapshots', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  // A legacy operator home may initially hold both config and canonical auth.
  await fs.copyFile(path.join(f.configuration, 'config.toml'), path.join(f.canonical, 'config.toml'));
  f.options.env.CODEX_HOME = f.canonical;
  const before = await fs.readFile(f.auth);
  await seedFormalAiClientHome(f.options);
  assert.equal(f.copied.length, 0);
  await assert.rejects(fs.lstat(path.join(f.destination, 'auth.json')), { code: 'ENOENT' });
  assert.doesNotMatch(await fs.readFile(path.join(f.destination, 'config.toml'), 'utf8'), /mcp_servers/u);
  assert.deepEqual(await fs.readFile(f.auth), before);
  const next = `${f.auth}.next`;
  await fs.writeFile(next, '{"tokens":{"access_token":"synthetic-replaced"}}', { mode: 0o600 });
  await fs.rename(next, f.auth);
  await seedFormalAiClientHome(f.options);
  assert.equal(f.copied.length, 0);
  assert.equal(JSON.parse(await fs.readFile(f.auth, 'utf8')).tokens.access_token, 'synthetic-replaced');
});

for (const conflict of ['source', 'destination']) {
  test(`Formal AI refuses a second ${conflict} credential authority before copying or rewriting configuration`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    const directory = conflict === 'source' ? f.configuration : f.destination;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const independent = path.join(directory, 'auth.json');
    const config = path.join(directory, 'config.toml');
    await fs.writeFile(independent, '{"synthetic":"preserved-independent-authority"}', { mode: 0o600 });
    await fs.writeFile(config, 'synthetic preserved configuration\n');
    const before = await fs.readFile(independent);
    await assert.rejects(seedFormalAiClientHome(f.options), /Canonical Codex authentication storage/u);
    assert.equal(f.copied.length, 0);
    assert.deepEqual(await fs.readFile(independent), before);
    assert.equal(await fs.readFile(config, 'utf8'), 'synthetic preserved configuration\n');
    if (conflict === 'source') await assert.rejects(fs.lstat(f.destination), { code: 'ENOENT' });
  });
}

for (const scenario of ['missing', 'public', 'relative']) {
  test(`Formal AI refuses ${scenario} selected credentials before creating configuration`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    if (scenario === 'missing') await fs.unlink(f.auth);
    if (scenario === 'public') await fs.chmod(f.canonical, 0o755);
    if (scenario === 'relative') f.options.env.CODEX_AUTH_HOME = '.';
    await assert.rejects(seedFormalAiClientHome(f.options), /Canonical Codex authentication storage/u);
    assert.equal(f.copied.length, 0);
    await assert.rejects(fs.lstat(f.destination), { code: 'ENOENT' });
  });
}

test('Formal AI refuses a credential injected while task configuration is written', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  f.options.writeFileImpl = async (...args) => {
    await fs.writeFile(...args);
    await fs.writeFile(path.join(f.destination, 'auth.json'), '{"synthetic":"concurrent-private-authority"}', { mode: 0o600 });
  };
  await assert.rejects(seedFormalAiClientHome(f.options), /Canonical Codex authentication storage/u);
  assert.equal(JSON.parse(await fs.readFile(f.auth, 'utf8')).tokens.access_token, 'synthetic-canonical');
});

test('the Formal AI configuration writer preserves the selected credential authority', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await seedFormalAiClientHome(f.options);
  const calls = [];
  await configureFormalAiClientHome({
    tool: 'codex',
    home: f.options.home,
    env: f.options.env,
    baseUrl: 'http://127.0.0.1:1',
    run: async (command, args, options) => {
      calls.push({ command, args, options });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.CODEX_AUTH_HOME, f.canonical);
  assert.equal(calls[0].options.env.CODEX_HOME, f.destination);
  await assert.rejects(fs.lstat(path.join(f.destination, 'auth.json')), { code: 'ENOENT' });
});

test('the Formal AI configuration writer refuses logout before invocation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await fs.unlink(f.auth);
  let calls = 0;
  await assert.rejects(
    configureFormalAiClientHome({
      tool: 'codex',
      home: f.options.home,
      env: f.options.env,
      baseUrl: 'http://127.0.0.1:1',
      run: async () => {
        calls++;
      },
    }),
    /Canonical Codex authentication storage/u
  );
  assert.equal(calls, 0);
});

test('the Formal AI configuration writer cannot publish an independent private credential', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await seedFormalAiClientHome(f.options);
  await assert.rejects(
    configureFormalAiClientHome({
      tool: 'codex',
      home: f.options.home,
      env: f.options.env,
      baseUrl: 'http://127.0.0.1:1',
      run: async () => {
        await fs.writeFile(path.join(f.destination, 'auth.json'), '{"synthetic":"writer-created-authority"}', { mode: 0o600 });
      },
    }),
    /Canonical Codex authentication storage/u
  );
  assert.equal(JSON.parse(await fs.readFile(f.auth, 'utf8')).tokens.access_token, 'synthetic-canonical');
});
