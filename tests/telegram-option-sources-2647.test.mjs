/**
 * @hive-mind-test-suite default
 * Issue #2647: every hive-telegram-bot option is available as a CLI argument and
 * as an environment variable, so it can also live in .lenv, .env, or a Links
 * Notation file selected with --configuration-file. Only fabricated credentials are used.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig, TELEGRAM_OPTION_ENVIRONMENT_VARIABLES } from '../src/telegram.config.lib.mjs';

const bot = fileURLToPath(new URL('../src/telegram-bot.mjs', import.meta.url));
// Read by the startup loader before the CLI parser runs (covered by telegram-configuration-file-2647).
const LOADED_BEFORE_PARSING = new Set(['configuration', 'configurationFile']);

function canonicalOptions() {
  const options = createYargsConfig(getLinoYargsFactory()([])).getOptions();
  const aliases = new Set(Object.values(options.alias).flat());
  return Object.keys(options.key).filter(key => !aliases.has(key) && !['h', 'help', 'version'].includes(key));
}

function parseWithEnvironment(name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return createYargsConfig(getLinoYargsFactory()([])).parse();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test('every hive-telegram-bot option has an environment variable', () => {
  const options = canonicalOptions();
  assert.ok(options.length >= 20, `expected the full option surface, got ${options.join(', ')}`);
  assert.deepEqual(
    options.filter(key => !TELEGRAM_OPTION_ENVIRONMENT_VARIABLES[key]),
    []
  );
  assert.deepEqual(
    Object.keys(TELEGRAM_OPTION_ENVIRONMENT_VARIABLES).filter(key => !options.includes(key)),
    []
  );
});

test('each environment variable changes its option default', () => {
  const defaults = createYargsConfig(getLinoYargsFactory()([])).parse();
  for (const [option, name] of Object.entries(TELEGRAM_OPTION_ENVIRONMENT_VARIABLES)) {
    if (LOADED_BEFORE_PARSING.has(option)) continue;
    const value = typeof defaults[option] === 'boolean' ? String(!defaults[option]) : 'value-from-environment';
    const parsed = parseWithEnvironment(name, value);
    assert.equal(String(parsed[option]), value, `${name} must configure --${option}`);
  }
});

function dryRun(args, cwd, additions = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TELEGRAM_') && key !== 'HIVE_MIND_CONFIGURATION_FILE'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bot, ...args], { cwd, env: { ...env, ...additions }, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('the same settings work from .lenv, .env, a custom file, the environment, and arguments', { timeout: 300000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-sources-2647-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lenv = "TELEGRAM_BOT_TOKEN: 'fake-source-2647'\nTELEGRAM_ALLOWED_CHATS: 123456789\nTELEGRAM_HIVE: false\nTELEGRAM_DRY_RUN: true";
  const sources = {
    '.lenv': async cwd => {
      await writeFile(join(cwd, '.lenv'), lenv, { mode: 0o600 });
      return [[], {}];
    },
    '.env': async cwd => {
      await writeFile(join(cwd, '.env'), 'TELEGRAM_BOT_TOKEN=fake-source-2647\nTELEGRAM_ALLOWED_CHATS=123456789\nTELEGRAM_HIVE=false\nTELEGRAM_DRY_RUN=true\n', { mode: 0o600 });
      return [[], {}];
    },
    'custom configuration file': async cwd => {
      await writeFile(join(cwd, 'custom bot.lenv'), lenv, { mode: 0o600 });
      return [['--configuration-file', join(cwd, 'custom bot.lenv')], {}];
    },
    environment: async () => [[], { TELEGRAM_BOT_TOKEN: 'fake-source-2647', TELEGRAM_ALLOWED_CHATS: '123456789', TELEGRAM_HIVE: 'false', TELEGRAM_DRY_RUN: 'true' }],
    arguments: async () => [['--token', 'fake-source-2647', '--allowed-chats', '123456789', '--no-hive', '--dry-run'], {}],
  };
  for (const [name, prepare] of Object.entries(sources)) {
    const cwd = await mkdtemp(join(directory, 'source-'));
    const [args, env] = await prepare(cwd);
    const { code, output } = await dryRun(args, cwd, env);
    assert.equal(code, 0, `${name}: ${output}`);
    assert.ok(output.includes('Dry-run mode'), `${name}: ${output}`);
    assert.ok(output.includes('Token: fak…647'), `${name}: ${output}`);
    assert.ok(output.includes('123456789'), `${name}: ${output}`);
    assert.ok(output.includes('hive: false'), `${name}: ${output}`);
    // Only the explicit --token argument is a secret on argv, and only it is warned about.
    assert.equal(output.includes('visible to every user and process'), name === 'arguments', `${name}: ${output}`);
  }
});
