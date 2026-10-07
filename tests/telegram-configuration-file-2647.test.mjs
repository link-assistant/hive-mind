/**
 * @hive-mind-test-suite default
 * Configuration source precedence and CLI integration for issue #2647.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadTelegramStartupConfig } from '../src/telegram-startup-config.lib.mjs';

const bot = fileURLToPath(new URL('../src/telegram-bot.mjs', import.meta.url));
const fileConfig = "TELEGRAM_BOT_TOKEN: 'fake-file-2647'\nTELEGRAM_ALLOWED_CHATS: 123456789\nTELEGRAM_HIVE: false\nTELEGRAM_SOLVE: false\nTELEGRAM_ISOLATION: screen";

function dryRun(args, cwd, additions = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TELEGRAM_') && key !== 'HIVE_MIND_CONFIGURATION_FILE'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bot, ...args, '--dry-run'], { cwd, env: { ...env, ...additions }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', data => (output += data));
    child.stderr.on('data', data => (output += data));
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

test('loads configuration sources before CLI defaults, with explicit inline/token options taking precedence', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-config-2647-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'bot config.lenv');
  await writeFile(path, fileConfig, { mode: 0o600 });
  const calls = [];
  const env = { HIVE_MIND_CONFIGURATION_FILE: '/missing', TELEGRAM_CONFIGURATION: 'environment config' };
  await loadTelegramStartupConfig({
    argv: [`--configuration-file=${path}`],
    env,
    inlineOptions: { configuration: 'inline config', token: 'fake-cli-token' },
    loadLenvConfig: async options => {
      calls.push(options);
    },
  });
  assert.deepEqual(
    calls.map(call => call.configuration),
    ['environment config', fileConfig, 'inline config']
  );
  assert.ok(calls.every(call => call.override && call.quiet));
  assert.equal(env.TELEGRAM_BOT_TOKEN, 'fake-cli-token');
  await assert.rejects(loadTelegramStartupConfig({ argv: ['--configuration-file'], env: {}, loadLenvConfig: async () => {} }), /requires a path/);
  await assert.rejects(loadTelegramStartupConfig({ argv: [], env: { HIVE_MIND_CONFIGURATION_FILE: '/missing-config-2647' }, loadLenvConfig: async () => {} }), /Unable to read/);
});

test('the bot reads a private LINO file and honors CLI overrides of file booleans', { timeout: 180000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-bot-2647-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'bot config.lenv');
  await writeFile(path, fileConfig, { mode: 0o600 });
  await writeFile(join(directory, '.lenv'), "TELEGRAM_BOT_TOKEN: 'fake-default-2647'\nTELEGRAM_ALLOWED_CHATS: 987654321");
  for (const [args, env] of [
    [['--configuration-file', path], {}],
    [[], { HIVE_MIND_CONFIGURATION_FILE: path }],
    [[`--configuration-file=${path}`, '--hive', '--isolation', 'tmux'], {}],
    [['--configuration-file', path, '--isolation', ''], {}],
  ]) {
    const { code, output } = await dryRun(args, directory, env);
    assert.equal(code, 0, output);
    assert.ok(output.includes('Token: fak…647'), output);
    assert.ok(!output.includes('fake-file-2647'), output);
    assert.ok(output.includes('123456789'), output);
    assert.ok(output.includes(args.includes('--hive') ? 'hive: true' : 'hive: false'), output);
    if (args.includes('')) assert.ok(!output.includes('Isolation mode enabled'), output);
    else assert.ok(output.includes(args.includes('tmux') ? 'tmux' : 'screen'), output);
  }
});

test('explicit inline configuration and --token override file and .lenv values', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-inline-2647-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'bot.lenv');
  await writeFile(path, fileConfig, { mode: 0o600 });
  const { code, output } = await dryRun(['--configuration-file', path, '-c', "TELEGRAM_BOT_TOKEN: 'fake-inline-2647'\nTELEGRAM_ALLOWED_CHATS: 234567890\nTELEGRAM_HIVE: true", '-t', 'cli-token-2647'], directory);
  assert.equal(code, 0, output);
  assert.ok(output.includes('Token: cli…647'), output);
  assert.ok(output.includes('234567890'), output);
  assert.ok(output.includes('hive: true'), output);
  assert.ok(!output.includes('cli-token-2647'), output);
});

test('an explicit unreadable file fails instead of silently using another credential source', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-missing-2647-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { code, output } = await dryRun(['--configuration-file', join(directory, 'missing.lenv')], directory, { TELEGRAM_BOT_TOKEN: 'fake-env-2647' });
  assert.equal(code, 1, output);
  assert.ok(output.includes('Unable to read'), output);
  assert.ok(!output.includes('All validations passed'), output);
});
