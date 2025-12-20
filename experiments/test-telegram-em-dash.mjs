#!/usr/bin/env node

/**
 * Test for em-dash to double-dash replacement in telegram bot
 * This test verifies that the parseCommandArgs function properly
 * converts Telegram's auto-replaced em-dashes (—) back to double-dashes (--)
 */

// Mock parseCommandArgs function (same as in telegram-bot.mjs)
function parseCommandArgs(text) {
  // Use only first line and trim it
  const firstLine = text.split('\n')[0].trim();
  const argsText = firstLine.replace(/^\/\w+\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

  // Replace em-dash (—) with double-dash (--) to fix Telegram auto-replacement
  const normalizedArgsText = argsText.replace(/—/g, '--');

  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < normalizedArgsText.length; i++) {
    const char = normalizedArgsText[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = null;
    } else if (char === ' ' && !inQuotes) {
      if (currentArg) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }

  if (currentArg) {
    args.push(currentArg);
  }

  return args;
}

// Test cases
const tests = [
  {
    name: 'Em-dash is replaced with double-dash',
    input: '/solve https://github.com/suenot/aicommit/issues/35 —fork',
    expected: ['https://github.com/suenot/aicommit/issues/35', '--fork']
  },
  {
    name: 'Multiple em-dashes are replaced',
    input: '/solve https://github.com/test/repo/issues/1 —fork —auto-continue —attach-logs',
    expected: ['https://github.com/test/repo/issues/1', '--fork', '--auto-continue', '--attach-logs']
  },
  {
    name: 'Normal double-dashes still work',
    input: '/solve https://github.com/test/repo/issues/1 --fork --auto-continue',
    expected: ['https://github.com/test/repo/issues/1', '--fork', '--auto-continue']
  },
  {
    name: 'Mixed em-dashes and double-dashes',
    input: '/solve https://github.com/test/repo/issues/1 —fork --auto-continue —verbose',
    expected: ['https://github.com/test/repo/issues/1', '--fork', '--auto-continue', '--verbose']
  },
  {
    name: 'Em-dash with value',
    input: '/solve https://github.com/test/repo/issues/1 —model sonnet',
    expected: ['https://github.com/test/repo/issues/1', '--model', 'sonnet']
  },
  {
    name: 'Command without flags',
    input: '/solve https://github.com/test/repo/issues/1',
    expected: ['https://github.com/test/repo/issues/1']
  },
  {
    name: 'Hive command with em-dashes',
    input: '/hive https://github.com/test/repo —verbose —all-issues',
    expected: ['https://github.com/test/repo', '--verbose', '--all-issues']
  }
];

let passed = 0;
let failed = 0;

console.log('Running telegram em-dash replacement tests...\n');

for (const test of tests) {
  const result = parseCommandArgs(test.input);
  const success = JSON.stringify(result) === JSON.stringify(test.expected);

  if (success) {
    console.log(`✅ PASS: ${test.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${test.name}`);
    console.log(`  Input:    ${test.input}`);
    console.log(`  Expected: ${JSON.stringify(test.expected)}`);
    console.log(`  Got:      ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${tests.length} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`${'='.repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
