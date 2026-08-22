#!/usr/bin/env node

/**
 * Regression coverage for issue #1981 default safety changes.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1981
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';
import { systemLimits } from '../src/config.lib.mjs';
import { QUEUE_CONFIG, DISPLAY_THRESHOLDS, isEnqueueStrategy, isRejectStrategy } from '../src/queue-config.lib.mjs';
import { createYargsConfig as createSolveYargsConfig, SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { createYargsConfig as createHiveYargsConfig } from '../src/hive.config.lib.mjs';
import { createYargsConfig as createTaskYargsConfig } from '../src/task.config.lib.mjs';
import { resolveYargsFactory } from '../src/yargs-factory.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const yargsModule = await use('yargs@17.7.2');
const yargs = resolveYargsFactory(yargsModule);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

async function parseSolve(args) {
  return createSolveYargsConfig(yargs())
    .exitProcess(false)
    .fail((message, error) => {
      throw error || new Error(message);
    })
    .parse(args);
}

async function parseHive(args) {
  return createHiveYargsConfig(yargs())
    .exitProcess(false)
    .fail((message, error) => {
      throw error || new Error(message);
    })
    .parse(args);
}

async function parseTask(args) {
  return createTaskYargsConfig(yargs())
    .exitProcess(false)
    .fail((message, error) => {
      throw error || new Error(message);
    })
    .parse(args);
}

function runTelegramDryRun(args = []) {
  return new Promise(resolve => {
    const env = { ...process.env };
    for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHATS', 'TELEGRAM_ALLOWED_TOPICS', 'TELEGRAM_HIVE_OVERRIDES', 'TELEGRAM_SOLVE_OVERRIDES', 'TELEGRAM_BOT_VERBOSE', 'TELEGRAM_CONFIGURATION', 'TELEGRAM_ISOLATION']) {
      delete env[key];
    }
    env.TELEGRAM_BOT_TOKEN = 'test-token-issue-1981';

    const proc = spawn(process.execPath, [join(projectRoot, 'src/telegram-bot.mjs'), '--dry-run', ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout.on('data', chunk => {
      output += chunk.toString();
    });
    proc.stderr.on('data', chunk => {
      output += chunk.toString();
    });

    proc.on('close', code => {
      resolve({ code, output });
    });
  });
}

console.log('\nIssue #1981 default safety checks\n');

test('queue disk threshold defaults to 65% used and display stays in sync', () => {
  assert.equal(QUEUE_CONFIG.thresholds.disk.value, 0.65);
  assert.equal(QUEUE_CONFIG.DISK_THRESHOLD, 0.65);
  assert.equal(DISPLAY_THRESHOLDS.DISK, 65);
});

test('queue disk strategy defaults to enqueue/wait instead of reject', () => {
  assert.equal(QUEUE_CONFIG.thresholds.disk.strategy, 'enqueue');
  assert.equal(isEnqueueStrategy('disk'), true);
  assert.equal(isRejectStrategy('disk'), false);
});

test('absolute free disk default is 10240 MB in shared config and solve definitions', () => {
  assert.equal(systemLimits.minDiskSpaceMb, 10240);
  assert.equal(SOLVE_OPTION_DEFINITIONS['min-disk-space'].default, 10240);
});

await asyncTest('solve parser exposes --min-disk-space default as 10240 MB', async () => {
  const argv = await parseSolve(['https://github.com/owner/repo/issues/1']);
  assert.equal(argv.minDiskSpace, 10240);
});

await asyncTest('hive parser inherits --min-disk-space default as 10240 MB', async () => {
  const argv = await parseHive(['https://github.com/owner/repo']);
  assert.equal(argv.minDiskSpace ?? argv['min-disk-space'], 10240);
});

await asyncTest('task parser defaults --isolation to docker', async () => {
  const argv = await parseTask(['Clarify this task']);
  assert.equal(argv.isolation, 'docker');
});

await asyncTest('telegram bot dry-run defaults to docker isolation', async () => {
  const { code, output } = await runTelegramDryRun();
  assert.equal(code, 0, output);
  assert.match(output, /Isolation mode enabled: docker/);
});

await asyncTest('telegram bot still allows explicit empty isolation opt-out', async () => {
  const { code, output } = await runTelegramDryRun(['--isolation', '']);
  assert.equal(code, 0, output);
  assert.doesNotMatch(output, /Isolation mode enabled:/);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
