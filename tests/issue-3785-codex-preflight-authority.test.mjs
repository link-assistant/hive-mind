// @hive-mind-test-suite default
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCodexCapabilityPreflight, verifyCodexCapabilityExecutionCatalog } from '../src/codex-capability-preflight.lib.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-preflight-authority-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const baseCodexHome = path.join(root, 'canonical');
  const projectDir = path.join(root, 'checkout');
  await fs.mkdir(baseCodexHome, { mode: 0o700 });
  await fs.mkdir(projectDir, { mode: 0o700 });
  const auth = path.join(baseCodexHome, 'auth.json');
  await fs.writeFile(auth, '{"tokens":{"access_token":"synthetic-original"}}', { mode: 0o600 });
  await fs.writeFile(path.join(baseCodexHome, 'config.toml'), '[features]\nremote_plugin=false\n');
  const calls = [];
  const runCommand = async invocation => {
    calls.push(invocation);
    assert.equal(invocation.command, 'codex');
    return { code: 0, stderr: '', stdout: JSON.stringify({ text: '<skills_instructions>\n### Available skills\n</skills_instructions>' }) };
  };
  return { root, auth, calls, options: { owner: 'fixture', repo: 'canonical', projectDir, baseCodexHome, env: { CODEX_AUTH_HOME: baseCodexHome, PATH: '/usr/bin:/bin' }, runCommand } };
}

test('selected canonical authentication is never copied into fresh capability scopes', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const before = await fs.stat(f.auth);
  const first = await runCodexCapabilityPreflight(f.options);
  t.after(first.dispose);
  await assert.rejects(fs.lstat(path.join(first.codexHome, 'auth.json')), { code: 'ENOENT' });
  const replacement = `${f.auth}.new`;
  await fs.writeFile(replacement, '{"tokens":{"access_token":"synthetic-replacement"}}', { mode: 0o600 });
  await fs.rename(replacement, f.auth);
  const second = await runCodexCapabilityPreflight(f.options);
  t.after(second.dispose);
  assert.notEqual(first.codexHome, second.codexHome);
  await assert.rejects(fs.lstat(path.join(second.codexHome, 'auth.json')), { code: 'ENOENT' });
  assert.notEqual((await fs.stat(f.auth)).ino, before.ino);
  assert.ok(f.calls.length >= 2);
  assert.ok(f.calls.every(call => call.env.CODEX_AUTH_HOME === f.options.env.CODEX_AUTH_HOME));
});

test('a second operator credential authority refuses before discovery or task allocation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const privateHome = path.join(f.root, 'configuration');
  await fs.mkdir(privateHome, { mode: 0o700 });
  const independent = path.join(privateHome, 'auth.json');
  await fs.writeFile(independent, '{"synthetic":"independent"}', { mode: 0o600 });
  const before = await fs.readFile(independent);
  await assert.rejects(runCodexCapabilityPreflight({ ...f.options, baseCodexHome: privateHome }), /Canonical Codex authentication storage/u);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await fs.readFile(independent), before);
  await assert.rejects(fs.lstat(path.join(f.root, '.hive-mind')), { code: 'ENOENT' });
});

for (const scenario of ['missing', 'public', 'relative']) {
  test(`unsafe ${scenario} selected authentication refuses before discovery`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    if (scenario === 'missing') await fs.unlink(f.auth);
    if (scenario === 'public') await fs.chmod(f.options.baseCodexHome, 0o755);
    if (scenario === 'relative') f.options.env.CODEX_AUTH_HOME = '.';
    await assert.rejects(runCodexCapabilityPreflight(f.options), /Canonical Codex authentication storage/u);
    assert.equal(f.calls.length, 0);
    await assert.rejects(fs.lstat(path.join(f.root, '.hive-mind')), { code: 'ENOENT' });
  });
}

test('the final catalog probe rejects an injected private credential authority', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const capabilityPreflight = await runCodexCapabilityPreflight(f.options);
  t.after(capabilityPreflight.dispose);
  await fs.writeFile(path.join(capabilityPreflight.codexHome, 'auth.json'), '{"synthetic":"injected"}', { mode: 0o600 });
  const count = f.calls.length;
  await assert.rejects(verifyCodexCapabilityExecutionCatalog({ ...f.options, capabilityPreflight }), /Canonical Codex authentication storage/u);
  assert.equal(f.calls.length, count);
});

test('a real selected preflight refuses an unverified command before any execution', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const bin = path.join(f.root, 'bin');
  await fs.mkdir(bin);
  const ran = path.join(f.root, 'unverified-ran');
  const codexPath = path.join(bin, 'codex');
  await fs.writeFile(codexPath, `#!/bin/sh\ntouch '${ran}'\necho '{"text":"<skills_instructions>\\n### Available skills\\n</skills_instructions>"}'\n`, { mode: 0o700 });
  await assert.rejects(runCodexCapabilityPreflight({ ...f.options, runCommand: undefined, codexPath }), /installed native Codex command could not be verified/u);
  await assert.rejects(fs.lstat(ran), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(f.root, '.hive-mind')), { code: 'ENOENT' });
});
