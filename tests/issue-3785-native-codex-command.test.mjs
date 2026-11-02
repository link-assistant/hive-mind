/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installNativeCodexCommand, verifyNativeCodexCommand } from '../src/native-codex-command.lib.mjs';
import { verifyAgentRuntime } from '../src/verify-agent-runtime.mjs';
import { nativeCodexPackagingFixture } from './helpers/native-codex-fixture.mjs';

const supported = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-codex-command-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, '@openai/codex');
  const bin = path.join(root, 'bin');
  await fs.mkdir(path.join(source, 'bin'), { recursive: true });
  await fs.mkdir(bin);
  await fs.writeFile(path.join(source, 'package.json'), '{"name":"@openai/codex","version":"0.164.0"}\n');
  const ran = path.join(root, 'unexpected-execution');
  const entrypoint = path.join(source, 'bin/codex.js');
  await fs.writeFile(entrypoint, `#!/bin/sh\ntouch '${ran}'\necho 'codex-cli 0.164.0'\n`, { mode: 0o700 });
  const command = path.join(bin, 'codex');
  await fs.symlink(entrypoint, command);
  return { root, source, command, entrypoint, ran, searchPath: bin };
}

test('a stock version label cannot admit the selected native command', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(verifyNativeCodexCommand(f), /installation and execution were refused/u);
  await assert.rejects(fs.access(f.ran), { code: 'ENOENT' });
  assert.equal(await fs.realpath(f.command), f.entrypoint);
});

test('missing compiled package bytes preserve the package-manager command', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const before = await fs.lstat(f.command);
  await assert.rejects(installNativeCodexCommand(f), /execution were refused/u);
  assert.equal((await fs.lstat(f.command)).ino, before.ino);
  assert.equal(await fs.realpath(f.command), f.entrypoint);
  assert.deepEqual(await fs.readdir(path.dirname(f.source)), ['codex']);
  await assert.rejects(fs.access(f.ran), { code: 'ENOENT' });
});

test('native activation never replaces an ordinary selected executable', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await fs.unlink(f.command);
  await fs.copyFile(f.entrypoint, f.command);
  const before = await fs.stat(f.command);
  await assert.rejects(installNativeCodexCommand(f), /execution were refused/u);
  assert.equal((await fs.stat(f.command)).ino, before.ino);
  await assert.rejects(fs.access(f.ran), { code: 'ENOENT' });
});

test('relative PATH entries cannot select a command for native activation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(installNativeCodexCommand({ command: 'codex', searchPath: '.' }), /execution were refused/u);
  assert.equal(await fs.realpath(f.command), f.entrypoint);
  await assert.rejects(fs.access(f.ran), { code: 'ENOENT' });
});

test('installed runtime admission rejects an unverified Codex before executing any CLI', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, '.codex'));
  await fs.writeFile(path.join(f.root, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\napps = false\n');
  await fs.mkdir(path.join(f.root, '.claude'));
  await fs.writeFile(path.join(f.root, '.claude/settings.json'), JSON.stringify({ syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } }));
  await assert.rejects(verifyAgentRuntime({ homeDir: f.root, codexCommand: f.command, claudeCommand: f.command }), /installed native Codex command could not be verified/u);
  await assert.rejects(fs.access(f.ran), { code: 'ENOENT' });
});

test('checked native activation replaces only the selected bin link and remains idempotent', { timeout: 10000, skip: !supported }, async t => {
  const f = await fixture(t);
  const packaged = await nativeCodexPackagingFixture(t);
  const sourceBefore = await fs.stat(f.entrypoint);
  const ready = await packaged.commandApi.installNativeCodexCommand(f);
  const binBefore = await fs.lstat(f.command);
  assert.equal(await fs.realpath(f.command), ready.entrypoint);
  assert.equal((await fs.stat(f.entrypoint)).ino, sourceBefore.ino);
  assert.equal((await packaged.commandApi.verifyNativeCodexCommand(f)).entrypoint, ready.entrypoint);
  assert.equal((await packaged.commandApi.installNativeCodexCommand(f)).entrypoint, ready.entrypoint);
  assert.equal((await fs.lstat(f.command)).ino, binBefore.ino);
  await assert.rejects(fs.access(f.ran), { code: 'ENOENT' });
  await fs.appendFile(ready.entrypoint, 'unadmitted bytes');
  await assert.rejects(packaged.commandApi.verifyNativeCodexCommand(f), /execution were refused/u);
  await assert.rejects(packaged.commandApi.installNativeCodexCommand(f), /execution were refused/u);
  assert.equal((await fs.lstat(f.command)).ino, binBefore.ino);
});

test('wrong stock metadata refuses before native generation or command publication', { timeout: 10000, skip: !supported }, async t => {
  const f = await fixture(t);
  const packaged = await nativeCodexPackagingFixture(t);
  await fs.writeFile(path.join(f.source, 'package.json'), '{"name":"@openai/codex","version":"0.0.0"}');
  const before = await fs.lstat(f.command);
  await assert.rejects(packaged.commandApi.installNativeCodexCommand(f), /execution were refused/u);
  assert.equal((await fs.lstat(f.command)).ino, before.ino);
  assert.deepEqual(await fs.readdir(path.dirname(f.source)), ['codex']);
  await assert.rejects(fs.access(f.ran), { code: 'ENOENT' });
});
