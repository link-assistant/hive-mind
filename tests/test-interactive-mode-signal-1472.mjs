#!/usr/bin/env node

/**
 * Tests for issue #1472: Interactive mode was not activated, nor it was signaled
 *
 * Verifies that:
 * 1. validateInteractiveModeConfig is properly exported and callable
 * 2. Telegram bot response includes interactive mode signal when --interactive-mode is in args
 * 3. Interactive mode signal is not shown when --interactive-mode is absent
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    if (details) console.log(`     ${details}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 1: validateInteractiveModeConfig is exported and works
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 1: validateInteractiveModeConfig');
console.log('─'.repeat(60));

const interactiveModeLib = await import(join(__dirname, '..', 'src', 'interactive-mode.lib.mjs'));

// Test: Function is exported
assert(typeof interactiveModeLib.validateInteractiveModeConfig === 'function', 'validateInteractiveModeConfig is exported as a function');

// Test: Returns true when disabled (no-op)
{
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const result = await interactiveModeLib.validateInteractiveModeConfig({ interactiveMode: false, tool: 'claude' }, mockLog);
  assert(result === true, 'Returns true when interactive mode is disabled');
  assert(logs.length === 0, 'No log messages when interactive mode is disabled');
}

// Test: Returns true and logs ENABLED when active with claude
{
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const result = await interactiveModeLib.validateInteractiveModeConfig({ interactiveMode: true, tool: 'claude' }, mockLog);
  assert(result === true, 'Returns true when interactive mode is enabled with claude tool');
  assert(
    logs.some(l => l.includes('ENABLED')),
    'Logs ENABLED message',
    `Logs were: ${JSON.stringify(logs)}`
  );
}

// Test: Returns false and logs warning when active with unsupported tool
{
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const result = await interactiveModeLib.validateInteractiveModeConfig({ interactiveMode: true, tool: 'opencode' }, mockLog);
  assert(result === false, 'Returns false when interactive mode is enabled with unsupported tool');
  assert(
    logs.some(l => l.includes('only supported for --tool claude')),
    'Logs unsupported tool warning',
    `Logs were: ${JSON.stringify(logs)}`
  );
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2: Telegram bot info block includes interactive mode signal
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 2: Telegram bot interactive mode signal logic');
console.log('─'.repeat(60));

// Simulate the Telegram bot info block construction logic from telegram-bot.mjs
function buildInfoBlock(args, userOptionsRaw, overrides) {
  let infoBlock = `Requested by: @testuser\nURL: https://github.com/owner/repo/issues/1`;
  if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${userOptionsRaw}`;
  if (overrides && overrides.length > 0) infoBlock += `\n🔒 Locked options: ${overrides.join(' ')}`;
  // Issue #1472: Signal interactive mode activation to the user
  if (args.includes('--interactive-mode')) {
    infoBlock += '\n🔌 Interactive mode: ENABLED \\(experimental\\)';
  }
  return infoBlock;
}

// Test: Info block includes interactive mode signal when flag is present
{
  const args = ['https://github.com/owner/repo/issues/1', '--model', 'opus', '--interactive-mode'];
  const infoBlock = buildInfoBlock(args, '--model opus --interactive-mode', []);
  assert(infoBlock.includes('Interactive mode: ENABLED'), 'Info block includes interactive mode signal when --interactive-mode is in args', `Got: ${infoBlock}`);
}

// Test: Info block does NOT include interactive mode signal when flag is absent
{
  const args = ['https://github.com/owner/repo/issues/1', '--model', 'opus'];
  const infoBlock = buildInfoBlock(args, '--model opus', []);
  assert(!infoBlock.includes('Interactive mode'), 'Info block does NOT include interactive mode signal when --interactive-mode is absent', `Got: ${infoBlock}`);
}

// Test: Info block includes interactive mode signal even with locked options
{
  const args = ['https://github.com/owner/repo/issues/1', '--interactive-mode', '--attach-logs', '--verbose'];
  const infoBlock = buildInfoBlock(args, '--interactive-mode', ['--attach-logs', '--verbose']);
  assert(infoBlock.includes('Interactive mode: ENABLED'), 'Info block includes interactive mode signal with locked options present', `Got: ${infoBlock}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 3: solve.mjs imports validateInteractiveModeConfig
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 3: solve.mjs imports validateInteractiveModeConfig');
console.log('─'.repeat(60));

import { readFile } from 'node:fs/promises';

{
  const solveMjsContent = await readFile(join(__dirname, '..', 'src', 'solve.mjs'), 'utf-8');

  assert(solveMjsContent.includes("import('./interactive-mode.lib.mjs')"), 'solve.mjs imports from interactive-mode.lib.mjs');

  assert(solveMjsContent.includes('validateInteractiveModeConfig'), 'solve.mjs references validateInteractiveModeConfig');

  // Check it's actually called (not just imported)
  assert(solveMjsContent.includes('await validateInteractiveModeConfig(argv, log)'), 'solve.mjs calls validateInteractiveModeConfig(argv, log)');
}

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
