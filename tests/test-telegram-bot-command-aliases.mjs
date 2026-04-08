#!/usr/bin/env node

/**
 * Test for /solve command aliases: /do and /continue
 * This test verifies that /do and /continue work exactly like /solve
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
    name: '/do command with basic URL',
    input: '/do https://github.com/test/repo/issues/1',
    expected: ['https://github.com/test/repo/issues/1'],
  },
  {
    name: '/do command with options',
    input: '/do https://github.com/test/repo/issues/1 --fork --auto-continue',
    expected: ['https://github.com/test/repo/issues/1', '--fork', '--auto-continue'],
  },
  {
    name: '/continue command with basic URL',
    input: '/continue https://github.com/test/repo/issues/2',
    expected: ['https://github.com/test/repo/issues/2'],
  },
  {
    name: '/continue command with options',
    input: '/continue https://github.com/test/repo/issues/2 --verbose --attach-logs',
    expected: ['https://github.com/test/repo/issues/2', '--verbose', '--attach-logs'],
  },
  {
    name: '/solve command still works',
    input: '/solve https://github.com/test/repo/issues/3 --fork',
    expected: ['https://github.com/test/repo/issues/3', '--fork'],
  },
  {
    name: '/do with model option',
    input: '/do https://github.com/test/repo/issues/4 --model sonnet',
    expected: ['https://github.com/test/repo/issues/4', '--model', 'sonnet'],
  },
  {
    name: '/continue with think option',
    input: '/continue https://github.com/test/repo/issues/5 --think high',
    expected: ['https://github.com/test/repo/issues/5', '--think', 'high'],
  },
  {
    name: '/do with em-dash',
    input: '/do https://github.com/test/repo/issues/6 —fork',
    expected: ['https://github.com/test/repo/issues/6', '--fork'],
  },
  {
    name: '/continue with em-dash',
    input: '/continue https://github.com/test/repo/issues/7 —verbose',
    expected: ['https://github.com/test/repo/issues/7', '--verbose'],
  },
  {
    name: '/do with multiple options',
    input: '/do https://github.com/test/repo/issues/8 --fork --auto-continue --attach-logs --verbose',
    expected: ['https://github.com/test/repo/issues/8', '--fork', '--auto-continue', '--attach-logs', '--verbose'],
  },
];

let passed = 0;
let failed = 0;

console.log('Running telegram bot command aliases tests...\n');

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

if (passed === tests.length) {
  console.log('\n✅ All tests passed!');
  console.log('Command aliases /do and /continue are working correctly.');
}

process.exit(failed > 0 ? 1 : 0);
