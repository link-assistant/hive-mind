#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Telegram bot CLI configuration (src/telegram.config.lib.mjs).
 *
 * The option surface was extracted from telegram-bot.mjs so it can be parsed
 * without starting the bot; these tests pin the command toggles, including the
 * /fix toggle added for issue #1733 and /organize for issue #2256.
 */

import assert from 'assert/strict';
import { getLinoYargsFactory, hideBin } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig } from '../src/telegram.config.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

const yargs = getLinoYargsFactory();

// Defaults read process.env when createYargsConfig() runs, so each parse must
// build a fresh instance with the environment already in place.
function parseArgs(args = [], env = {}) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    // .fail()/.exitProcess(false) turn yargs' default "print help and exit" into
    // a thrown error so strict-mode rejections are observable from a test.
    return createYargsConfig(yargs(hideBin(['node', 'telegram-bot.mjs', ...args])))
      .exitProcess(false)
      .fail((message, error) => {
        throw error || new Error(message);
      })
      .parse();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

await test('every command is enabled by default', () => {
  const config = parseArgs([], { TELEGRAM_SOLVE: undefined, TELEGRAM_HIVE: undefined, TELEGRAM_TASK: undefined, TELEGRAM_FIX: undefined, TELEGRAM_ORGANIZE: undefined, TELEGRAM_AUTH: undefined });
  assert.equal(config.solve, true);
  assert.equal(config.hive, true);
  assert.equal(config.task, true);
  assert.equal(config.fix, true);
  assert.equal(config.organize, true);
  assert.equal(config.auth, true);
});

await test('/organize can be disabled by CLI or environment', () => {
  assert.equal(parseArgs(['--no-organize'], { TELEGRAM_ORGANIZE: undefined }).organize, false);
  assert.equal(parseArgs([], { TELEGRAM_ORGANIZE: 'false' }).organize, false);
  assert.equal(parseArgs(['--organize'], { TELEGRAM_ORGANIZE: 'false' }).organize, true);
});

await test('--no-fix disables the /fix command (issue #1733)', () => {
  const config = parseArgs(['--no-fix'], { TELEGRAM_FIX: undefined });
  assert.equal(config.fix, false);
  assert.equal(config.task, true, 'other command toggles are unaffected');
});

await test('TELEGRAM_FIX=false disables the /fix command (issue #1733)', () => {
  assert.equal(parseArgs([], { TELEGRAM_FIX: 'false' }).fix, false);
  assert.equal(parseArgs([], { TELEGRAM_FIX: 'true' }).fix, true);
});

await test('--fix overrides TELEGRAM_FIX=false', () => {
  assert.equal(parseArgs(['--fix'], { TELEGRAM_FIX: 'false' }).fix, true);
});

await test('unknown options are rejected in strict mode', () => {
  assert.throws(() => parseArgs(['--not-an-option']), /Unknown argument/i);
});

await test('isolation defaults to docker and stays overridable', () => {
  assert.equal(parseArgs([], { TELEGRAM_ISOLATION: undefined }).isolation, 'docker');
  assert.equal(parseArgs([], { TELEGRAM_ISOLATION: 'screen' }).isolation, 'screen');
  assert.equal(parseArgs(['--isolation', 'tmux'], { TELEGRAM_ISOLATION: 'screen' }).isolation, 'tmux');
});

await test('container limits default to unlimited and accept fixed or percentage values', () => {
  const defaults = parseArgs([], { TELEGRAM_CONTAINER_CPU: undefined, TELEGRAM_CONTAINER_MEMORY: undefined, TELEGRAM_CONTAINER_DISK: undefined });
  assert.equal(defaults.containerCpu, '');
  assert.equal(defaults.containerMemory, '');
  assert.equal(defaults.containerDisk, '');
  const configured = parseArgs(['--container-cpu', '50%', '--container-memory', '2GiB', '--container-disk', '10%']);
  assert.equal(configured.containerCpu, '50%');
  assert.equal(configured.containerMemory, '2GiB');
  assert.equal(configured.containerDisk, '10%');
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
