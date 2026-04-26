#!/usr/bin/env node
// Test for issue #477: Ensure warnings in stderr are not treated as errors
// Updated for issue #1337: Also handle JSON-structured log messages
// This simulates the stderr error detection logic from claude.lib.mjs

const testCases = [
  // === Emoji-prefixed warnings (Issue #477) ===
  {
    name: 'BashTool warning with "failed" word',
    message: '⚠️  [BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests.',
    shouldBeError: false,
  },
  {
    name: 'BashTool warning (alternative emoji)',
    message: '⚠ [BashTool] Another warning message',
    shouldBeError: false,
  },
  {
    name: 'Real error with Error:',
    message: 'Error: Something went wrong',
    shouldBeError: true,
  },
  {
    name: 'Real error with lowercase error',
    message: 'npm error code ENOENT',
    shouldBeError: true,
  },
  {
    name: 'Real failure message',
    message: 'Command failed with exit code 1',
    shouldBeError: true,
  },
  {
    name: 'Warning without emoji but with "failed"',
    message: 'Warning: This failed to connect',
    shouldBeError: true, // Should be error since no warning emoji or JSON level
  },
  {
    name: 'Empty message',
    message: '',
    shouldBeError: false,
  },
  {
    name: 'Warning with spaces before emoji',
    message: '  ⚠️  Some warning text with failed in it',
    shouldBeError: false,
  },
  // === JSON-structured log messages (Issue #1337) ===
  {
    name: 'JSON warn - BashTool pre-flight with "failed" (Issue #1337)',
    message: '{"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests."}',
    shouldBeError: false,
  },
  {
    name: 'JSON error level - real error',
    message: '{"level":"error","message":"API Error: 500 Internal Server Error"}',
    shouldBeError: true,
  },
  {
    name: 'JSON info level - informational (not error)',
    message: '{"level":"info","message":"Session started successfully"}',
    shouldBeError: false,
  },
];

// Simulate the detection logic from claude.lib.mjs (after Issue #1337 fix)
function shouldBeDetectedAsError(message) {
  const trimmed = message.trim();

  // Detection 1: Emoji-prefixed warnings (Issue #477)
  let isWarning = trimmed.startsWith('⚠️') || trimmed.startsWith('⚠');

  // Detection 2: JSON-structured log messages (Issue #1337)
  if (!isWarning && trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.level === 'string') {
        const level = parsed.level.toLowerCase();
        if (level !== 'error' && level !== 'fatal') {
          isWarning = true;
        }
      }
    } catch {
      // Not valid JSON — fall through to keyword matching
    }
  }

  if (trimmed && !isWarning && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed'))) {
    return true;
  }

  return false;
}

console.log('Testing stderr warning detection for issue #477 (updated for #1337)...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const detected = shouldBeDetectedAsError(testCase.message);
  const expected = testCase.shouldBeError;
  const result = detected === expected ? '✅ PASS' : '❌ FAIL';

  if (detected === expected) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${result}: ${testCase.name}`);
  console.log(`   Message: "${testCase.message.substring(0, 80)}${testCase.message.length > 80 ? '...' : ''}"`);
  console.log(`   Expected error: ${expected}, Detected as error: ${detected}`);
  console.log('');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
  process.exit(0);
}
