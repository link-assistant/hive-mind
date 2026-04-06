#!/usr/bin/env node
/**
 * Tests for extractIsolationFromArgs function in telegram-bot.mjs
 *
 * Verifies that --isolation <backend> is correctly extracted from user args
 * in /solve and /hive Telegram commands, and that the remaining args are
 * properly filtered.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1534
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    console.error(`    Expected: ${expectedStr}`);
    console.error(`    Actual:   ${actualStr}`);
    failed++;
  }
}

/**
 * Re-implement extractIsolationFromArgs for testing purposes.
 * This mirrors the function in telegram-bot.mjs (which cannot be easily imported
 * because it's embedded in a top-level script that requires Telegram bot setup).
 */
function extractIsolationFromArgs(args) {
  const filteredArgs = [];
  let backend = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--isolation' && i + 1 < args.length) {
      backend = args[i + 1].trim().toLowerCase();
      i++; // Skip the value
    } else if (args[i].startsWith('--isolation=')) {
      backend = args[i].substring('--isolation='.length).trim().toLowerCase();
    } else {
      filteredArgs.push(args[i]);
    }
  }
  return { backend, filteredArgs };
}

console.log('Testing extractIsolationFromArgs (issue #1534)');
console.log('='.repeat(60));

// Test: No --isolation flag
console.log('\n  No --isolation flag:');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--verbose']);
  assert(result.backend === null, 'backend is null when no --isolation flag');
  assertDeepEqual(result.filteredArgs, ['https://github.com/owner/repo/issues/1', '--verbose'], 'args unchanged when no --isolation flag');
}

// Test: --isolation screen (the original bug scenario)
console.log('\n  --isolation screen (original bug):');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--isolation', 'screen']);
  assert(result.backend === 'screen', 'backend is "screen"');
  assertDeepEqual(result.filteredArgs, ['https://github.com/owner/repo/issues/1'], '--isolation and value removed from args');
}

// Test: --isolation tmux
console.log('\n  --isolation tmux:');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--isolation', 'tmux', '--verbose']);
  assert(result.backend === 'tmux', 'backend is "tmux"');
  assertDeepEqual(result.filteredArgs, ['https://github.com/owner/repo/issues/1', '--verbose'], '--isolation stripped, other args preserved');
}

// Test: --isolation docker
console.log('\n  --isolation docker:');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--isolation', 'docker']);
  assert(result.backend === 'docker', 'backend is "docker"');
}

// Test: --isolation=screen (equals syntax)
console.log('\n  --isolation=screen (equals syntax):');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--isolation=screen', '--verbose']);
  assert(result.backend === 'screen', 'backend is "screen" with equals syntax');
  assertDeepEqual(result.filteredArgs, ['https://github.com/owner/repo/issues/1', '--verbose'], '--isolation=screen stripped from args');
}

// Test: --isolation at the beginning of args
console.log('\n  --isolation at beginning:');
{
  const result = extractIsolationFromArgs(['--isolation', 'screen', 'https://github.com/owner/repo/issues/1', '--model', 'opus']);
  assert(result.backend === 'screen', 'backend extracted from beginning');
  assertDeepEqual(result.filteredArgs, ['https://github.com/owner/repo/issues/1', '--model', 'opus'], 'URL and other args preserved');
}

// Test: --isolation in the middle of args with multiple other flags
console.log('\n  --isolation in the middle with multiple flags:');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--model', 'opus', '--isolation', 'screen', '--verbose', '--attach-logs']);
  assert(result.backend === 'screen', 'backend extracted from middle');
  assertDeepEqual(result.filteredArgs, ['https://github.com/owner/repo/issues/1', '--model', 'opus', '--verbose', '--attach-logs'], 'all other args preserved in order');
}

// Test: Case insensitivity
console.log('\n  Case insensitivity:');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--isolation', 'SCREEN']);
  assert(result.backend === 'screen', 'backend is lowercased');
}

// Test: --isolation with whitespace in value
console.log('\n  --isolation with whitespace:');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--isolation', '  screen  ']);
  assert(result.backend === 'screen', 'backend is trimmed');
}

// Test: --isolation as last arg (no value)
console.log('\n  --isolation as last arg (no value):');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--isolation']);
  assert(result.backend === null, 'backend is null when --isolation has no value');
  assertDeepEqual(result.filteredArgs, ['https://github.com/owner/repo/issues/1', '--isolation'], '--isolation kept in args when no value');
}

// Test: Empty args
console.log('\n  Empty args:');
{
  const result = extractIsolationFromArgs([]);
  assert(result.backend === null, 'backend is null for empty args');
  assertDeepEqual(result.filteredArgs, [], 'filtered args is empty');
}

// Test: Invalid backend value (validation happens elsewhere)
console.log('\n  Invalid backend value (extraction only):');
{
  const result = extractIsolationFromArgs(['https://github.com/owner/repo/issues/1', '--isolation', 'ssh']);
  assert(result.backend === 'ssh', 'extracts invalid backend (validation is separate)');
  assertDeepEqual(result.filteredArgs, ['https://github.com/owner/repo/issues/1'], '--isolation stripped even for invalid backend');
}

// Results
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('='.repeat(60));

if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) failed!`);
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
