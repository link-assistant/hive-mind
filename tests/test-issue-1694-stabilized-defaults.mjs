#!/usr/bin/env node

/**
 * Regression test for issue #1694.
 *
 * Locks in the post-stabilization defaults for four options that were flipped
 * from opt-in (false / empty) to opt-out (true / 'screen'):
 *   - --auto-accept-invite             (solve / hive defaults to true)
 *   - --tokens-budget-stats            (solve / hive defaults to true)
 *   - --auto-attach-solution-summary   (solve / hive defaults to true)
 *   - --isolation                      (hive-telegram-bot defaults to 'screen')
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1694
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createYargsConfig as createSolveYargsConfig, SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { createYargsConfig as createHiveYargsConfig } from '../src/hive.config.lib.mjs';
import { resolveYargsFactory } from '../src/yargs-factory.lib.mjs';

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = resolveYargsFactory(yargsModule);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`✅ ${name}`);
  passed++;
}

function fail(name, expected, actual) {
  console.log(`❌ ${name}`);
  console.log(`   expected: ${expected}`);
  console.log(`   actual:   ${actual}`);
  failed++;
}

function assertEqual(name, actual, expected) {
  if (actual === expected) pass(name);
  else fail(name, JSON.stringify(expected), JSON.stringify(actual));
}

console.log('\n================================================================================');
console.log('Issue #1694: Stabilized option defaults');
console.log('================================================================================\n');

// 1. Inspect SOLVE_OPTION_DEFINITIONS directly — single source of truth for solve + hive.
console.log('📋 SOLVE_OPTION_DEFINITIONS\n');
assertEqual('SOLVE_OPTION_DEFINITIONS["auto-accept-invite"].default === true', SOLVE_OPTION_DEFINITIONS['auto-accept-invite']?.default, true);
assertEqual('SOLVE_OPTION_DEFINITIONS["tokens-budget-stats"].default === true', SOLVE_OPTION_DEFINITIONS['tokens-budget-stats']?.default, true);
assertEqual('SOLVE_OPTION_DEFINITIONS["auto-attach-solution-summary"].default === true', SOLVE_OPTION_DEFINITIONS['auto-attach-solution-summary']?.default, true);

// 2. Confirm the solve yargs parser exposes those defaults via parsed argv.
console.log('\n📋 solve parser argv\n');
{
  const baseArgs = ['https://github.com/owner/repo/issues/1'];
  const argv = await createSolveYargsConfig(yargs())
    .exitProcess(false)
    .fail((m, e) => {
      throw e || new Error(m);
    })
    .parse(baseArgs);

  assertEqual('solve parsed argv.autoAcceptInvite === true', argv.autoAcceptInvite, true);
  assertEqual('solve parsed argv.tokensBudgetStats === true', argv.tokensBudgetStats, true);
  assertEqual('solve parsed argv.autoAttachSolutionSummary === true', argv.autoAttachSolutionSummary, true);

  const argvNo = await createSolveYargsConfig(yargs())
    .exitProcess(false)
    .fail((m, e) => {
      throw e || new Error(m);
    })
    .parse([...baseArgs, '--no-auto-accept-invite', '--no-tokens-budget-stats', '--no-auto-attach-solution-summary']);

  assertEqual('solve --no-auto-accept-invite disables flag', argvNo.autoAcceptInvite, false);
  assertEqual('solve --no-tokens-budget-stats disables flag', argvNo.tokensBudgetStats, false);
  assertEqual('solve --no-auto-attach-solution-summary disables flag', argvNo.autoAttachSolutionSummary, false);
}

// 3. Confirm the hive yargs parser inherits the new defaults via SOLVE_OPTION_DEFINITIONS auto-registration.
console.log('\n📋 hive parser argv\n');
{
  const baseArgs = ['https://github.com/owner/repo'];
  const argv = await createHiveYargsConfig(yargs())
    .exitProcess(false)
    .fail((m, e) => {
      throw e || new Error(m);
    })
    .parse(baseArgs);

  assertEqual('hive parsed argv.autoAcceptInvite === true', argv['auto-accept-invite'] ?? argv.autoAcceptInvite, true);
  assertEqual('hive parsed argv.tokensBudgetStats === true', argv['tokens-budget-stats'] ?? argv.tokensBudgetStats, true);
  assertEqual('hive parsed argv.autoAttachSolutionSummary === true', argv['auto-attach-solution-summary'] ?? argv.autoAttachSolutionSummary, true);
}

// 4. Confirm the Telegram bot defaults --isolation to 'screen'. Use --dry-run so we don't actually start the bot.
console.log('\n📋 hive-telegram-bot --isolation default\n');
await new Promise(resolve => {
  const env = { ...process.env };
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHATS', 'TELEGRAM_ALLOWED_TOPICS', 'TELEGRAM_HIVE_OVERRIDES', 'TELEGRAM_SOLVE_OVERRIDES', 'TELEGRAM_BOT_VERBOSE', 'TELEGRAM_CONFIGURATION', 'TELEGRAM_ISOLATION']) {
    delete env[key];
  }
  env.TELEGRAM_BOT_TOKEN = 'test-token-issue-1694';

  const proc = spawn(process.execPath, [join(projectRoot, 'src/telegram-bot.mjs'), '--dry-run'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  proc.stdout.on('data', c => (out += c.toString()));
  proc.stderr.on('data', c => (out += c.toString()));

  proc.on('close', code => {
    if (code !== 0) {
      fail('telegram-bot --dry-run exits 0 with default isolation', '0', String(code));
      console.log('--- output ---');
      console.log(out);
      resolve();
      return;
    }
    if (out.includes('🔒 Isolation mode enabled: screen')) {
      pass('telegram-bot reports isolation backend = screen by default');
    } else {
      fail('telegram-bot reports isolation backend = screen by default', "log line '🔒 Isolation mode enabled: screen'", out);
    }
    resolve();
  });
});

// 5. Confirm explicit empty isolation disables the screen backend.
await new Promise(resolve => {
  const env = { ...process.env };
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHATS', 'TELEGRAM_ALLOWED_TOPICS', 'TELEGRAM_HIVE_OVERRIDES', 'TELEGRAM_SOLVE_OVERRIDES', 'TELEGRAM_BOT_VERBOSE', 'TELEGRAM_CONFIGURATION', 'TELEGRAM_ISOLATION']) {
    delete env[key];
  }
  env.TELEGRAM_BOT_TOKEN = 'test-token-issue-1694';
  env.TELEGRAM_ISOLATION = '';

  const proc = spawn(process.execPath, [join(projectRoot, 'src/telegram-bot.mjs'), '--dry-run', '--isolation', ''], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  proc.stdout.on('data', c => (out += c.toString()));
  proc.stderr.on('data', c => (out += c.toString()));

  proc.on('close', code => {
    if (code !== 0) {
      fail('telegram-bot --dry-run --isolation "" exits 0', '0', String(code));
      console.log('--- output ---');
      console.log(out);
      resolve();
      return;
    }
    if (out.includes('🔒 Isolation mode enabled')) {
      fail('--isolation "" opts out of screen', 'no isolation log line', out);
    } else {
      pass('--isolation "" opts out of screen (no isolation log line)');
    }
    resolve();
  });
});

console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================\n');

process.exit(failed === 0 ? 0 : 1);
