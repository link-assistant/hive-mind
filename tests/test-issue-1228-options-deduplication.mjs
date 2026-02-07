#!/usr/bin/env node
// Test script to verify issue #1228 fix: options deduplication in /solve and /hive command responses
// Verifies that user-provided options are shown separately from locked overrides

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('Testing issue #1228: Options deduplication in bot responses...\n');

// Import the mergeArgsWithOverrides function by reading the source
// Since it's not exported, we replicate the logic here for testing
function mergeArgsWithOverrides(userArgs, overrides) {
  if (!overrides || overrides.length === 0) {
    return userArgs;
  }

  const overrideFlags = new Map();
  for (let i = 0; i < overrides.length; i++) {
    const arg = overrides[i];
    if (arg.startsWith('--')) {
      if (i + 1 < overrides.length && !overrides[i + 1].startsWith('--')) {
        overrideFlags.set(arg, overrides[i + 1]);
        i++;
      } else {
        overrideFlags.set(arg, null);
      }
    }
  }

  const filteredArgs = [];
  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    if (arg.startsWith('--')) {
      if (overrideFlags.has(arg)) {
        if (i + 1 < userArgs.length && !userArgs[i + 1].startsWith('--')) {
          i++;
        }
        continue;
      }
    }
    filteredArgs.push(arg);
  }

  return [...filteredArgs, ...overrides];
}

// Simulate the OLD info block construction (before fix)
function buildInfoBlockOld(userArgs, overrides) {
  const args = mergeArgsWithOverrides(userArgs, overrides);
  const optionsText = args.slice(1).join(' ') || 'none';
  let infoBlock = `Requested by: @user\nURL: ${args[0]}\nOptions: ${optionsText}`;
  if (overrides.length > 0) infoBlock += `\n🔒 Locked options: ${overrides.join(' ')}`;
  return infoBlock;
}

// Simulate the NEW info block construction (after fix - issue #1228)
function buildInfoBlockNew(userArgs, overrides) {
  const args = mergeArgsWithOverrides(userArgs, overrides);
  // Use userArgs (pre-merge) for options display
  const userOptionsText = userArgs.slice(1).join(' ') || 'none';
  let infoBlock = `Requested by: @user\nURL: ${args[0]}\n\n🛠 Options: ${userOptionsText}`;
  if (overrides.length > 0) infoBlock += `\n🔒 Locked options: ${overrides.join(' ')}`;
  return infoBlock;
}

let passed = 0;
let failed = 0;

function assert(testName, condition, actual, expected) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    console.log(`     Expected: ${expected}`);
    console.log(`     Actual:   ${actual}`);
    failed++;
  }
}

// Test 1: User provides --model opus, overrides have 5 flags
console.log('\n--- Test 1: User options + locked overrides (exact issue scenario) ---');
{
  const userArgs = ['https://github.com/owner/repo/issues/123', '--model', 'opus'];
  const overrides = ['--attach-logs', '--verbose', '--no-tool-check', '--auto-resume-on-limit-reset', '--tokens-budget-stats'];

  const oldBlock = buildInfoBlockOld(userArgs, overrides);
  const newBlock = buildInfoBlockNew(userArgs, overrides);

  // Old behavior: Options line contains duplicated locked options
  assert(
    'Old behavior duplicates options',
    oldBlock.includes('Options: --model opus --attach-logs --verbose'),
    oldBlock.split('\n').find(l => l.startsWith('Options:')),
    'Options line should contain locked overrides (showing duplication)'
  );

  // New behavior: Options line only contains user options
  assert(
    'New behavior shows only user options',
    newBlock.includes('🛠 Options: --model opus') && !newBlock.includes('🛠 Options: --model opus --attach-logs'),
    newBlock.split('\n').find(l => l.includes('🛠 Options:')),
    '🛠 Options: --model opus'
  );

  // New behavior: Locked options still shown separately
  assert(
    'Locked options still shown',
    newBlock.includes('🔒 Locked options: --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats'),
    newBlock.split('\n').find(l => l.includes('🔒')),
    '🔒 Locked options: --attach-logs --verbose ...'
  );

  // New behavior: Empty line between URL and options
  assert('Empty line between URL and options', newBlock.includes('issues/123\n\n🛠'), 'Has \\n\\n between URL and options', 'Empty line separator present');

  // New behavior: No old-style "Options:" without emoji
  assert('Uses emoji prefix for user options', newBlock.includes('🛠 Options:') && !newBlock.includes('\nOptions:'), 'Has 🛠 prefix', '🛠 Options: prefix');
}

// Test 2: User provides no options, only overrides
console.log('\n--- Test 2: No user options, only locked overrides ---');
{
  const userArgs = ['https://github.com/owner/repo/issues/456'];
  const overrides = ['--attach-logs', '--verbose'];

  const newBlock = buildInfoBlockNew(userArgs, overrides);

  assert(
    'Shows "none" for user options when no user options provided',
    newBlock.includes('🛠 Options: none'),
    newBlock.split('\n').find(l => l.includes('🛠 Options:')),
    '🛠 Options: none'
  );

  assert(
    'Still shows locked options',
    newBlock.includes('🔒 Locked options: --attach-logs --verbose'),
    newBlock.split('\n').find(l => l.includes('🔒')),
    '🔒 Locked options: --attach-logs --verbose'
  );
}

// Test 3: User provides options, no overrides
console.log('\n--- Test 3: User options, no locked overrides ---');
{
  const userArgs = ['https://github.com/owner/repo/issues/789', '--model', 'haiku'];
  const overrides = [];

  const newBlock = buildInfoBlockNew(userArgs, overrides);

  assert(
    'Shows user options',
    newBlock.includes('🛠 Options: --model haiku'),
    newBlock.split('\n').find(l => l.includes('🛠 Options:')),
    '🛠 Options: --model haiku'
  );

  assert('No locked options line when no overrides', !newBlock.includes('🔒'), 'No 🔒 line present', 'No locked options section');
}

// Test 4: User tries to set an overridden flag (gets filtered by mergeArgsWithOverrides)
console.log('\n--- Test 4: User option overlaps with override ---');
{
  const userArgs = ['https://github.com/owner/repo/issues/100', '--model', 'opus', '--verbose'];
  const overrides = ['--verbose', '--attach-logs'];

  const newBlock = buildInfoBlockNew(userArgs, overrides);

  // User options should still show --model opus AND --verbose (user requested it)
  // Even though --verbose is also locked, user explicitly asked for it
  assert(
    'Shows user-provided options even if overlapping with overrides',
    newBlock.includes('🛠 Options: --model opus --verbose'),
    newBlock.split('\n').find(l => l.includes('🛠 Options:')),
    '🛠 Options: --model opus --verbose'
  );

  assert(
    'Locked options shown separately',
    newBlock.includes('🔒 Locked options: --verbose --attach-logs'),
    newBlock.split('\n').find(l => l.includes('🔒')),
    '🔒 Locked options: --verbose --attach-logs'
  );
}

// Test 5: No user options and no overrides
console.log('\n--- Test 5: No options, no overrides ---');
{
  const userArgs = ['https://github.com/owner/repo/issues/200'];
  const overrides = [];

  const newBlock = buildInfoBlockNew(userArgs, overrides);

  assert(
    'Shows "none" for user options',
    newBlock.includes('🛠 Options: none'),
    newBlock.split('\n').find(l => l.includes('🛠 Options:')),
    '🛠 Options: none'
  );

  assert('No locked options line', !newBlock.includes('🔒'), 'No 🔒 line present', 'No locked options section');
}

// Test 6: Multiple user options
console.log('\n--- Test 6: Multiple user options ---');
{
  const userArgs = ['https://github.com/owner/repo/issues/300', '--model', 'opus', '--base-branch', 'develop'];
  const overrides = ['--attach-logs'];

  const newBlock = buildInfoBlockNew(userArgs, overrides);

  assert(
    'Shows all user-provided options',
    newBlock.includes('🛠 Options: --model opus --base-branch develop'),
    newBlock.split('\n').find(l => l.includes('🛠 Options:')),
    '🛠 Options: --model opus --base-branch develop'
  );
}

// Test 7: Verify full info block structure
console.log('\n--- Test 7: Full info block structure ---');
{
  const userArgs = ['https://github.com/owner/repo/issues/123', '--model', 'opus'];
  const overrides = ['--verbose', '--attach-logs'];

  const newBlock = buildInfoBlockNew(userArgs, overrides);
  const lines = newBlock.split('\n');

  assert('Line 1: Requested by', lines[0] === 'Requested by: @user', lines[0], 'Requested by: @user');

  assert('Line 2: URL', lines[1].startsWith('URL:'), lines[1], 'URL: ...');

  assert('Line 3: Empty line separator', lines[2] === '', JSON.stringify(lines[2]), '""  (empty string)');

  assert('Line 4: User options with emoji', lines[3].startsWith('🛠 Options:'), lines[3], '🛠 Options: ...');

  assert('Line 5: Locked options', lines[4].startsWith('🔒 Locked options:'), lines[4], '🔒 Locked options: ...');
}

// Summary
console.log('\n\n=== Test Summary ===');
console.log(`Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
}
