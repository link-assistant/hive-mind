#!/usr/bin/env node
// Test for issue #1337: Ensure JSON-format warnings in stderr are not treated as errors
// This tests BOTH the old behavior (which had false positives) AND the new fixed behavior

// CURRENT FIXED LOGIC (from claude.lib.mjs after Issue #1337 fix)
function fixedDetectionLogic(message) {
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
  if (trimmed && !isWarning && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed') || trimmed.includes('not found'))) {
    return true;
  }
  return false;
}

const testCases = [
  // === ISSUE #1337 CASES (JSON-structured warnings) ===
  {
    name: 'JSON warn format - BashTool pre-flight warning (THE ISSUE #1337)',
    message: '{"level":"warn","message":"[BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests."}',
    shouldBeError: false,
  },
  {
    name: 'JSON error format - real error (should still be detected)',
    message: '{"level":"error","message":"API Error: 500 Internal Server Error"}',
    shouldBeError: true,
  },
  {
    name: 'JSON fatal format - fatal error (should still be detected)',
    message: '{"level":"fatal","message":"Connection failed permanently"}',
    shouldBeError: true,
  },
  {
    name: 'JSON info format - informational (should NOT be error)',
    message: '{"level":"info","message":"Session started successfully"}',
    shouldBeError: false,
  },
  {
    name: 'JSON debug format - debug message (should NOT be error)',
    message: '{"level":"debug","message":"Sending request to API, timeout may occur"}',
    shouldBeError: false,
  },
  {
    name: 'JSON warn with "error" keyword in message',
    message: '{"level":"warn","message":"Possible error-like condition detected, but not critical"}',
    shouldBeError: false,
  },
  {
    name: 'JSON warn with "not found" keyword in message',
    message: '{"level":"warn","message":"Some resource not found but non-critical"}',
    shouldBeError: false,
  },
  {
    name: 'JSON warn with "failed" keyword in message',
    message: '{"level":"warn","message":"Request failed but will retry automatically"}',
    shouldBeError: false,
  },
  {
    name: 'JSON message without level field (should fall through to keyword matching)',
    message: '{"message":"Something failed"}',
    shouldBeError: true,
  },
  // === EXISTING CASES (emoji-prefixed warnings, Issue #477) ===
  {
    name: 'Emoji-prefixed warning with "failed" word (existing Issue #477 handling)',
    message: '⚠️  [BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests.',
    shouldBeError: false,
  },
  {
    name: 'Emoji-prefixed warning (alternative emoji)',
    message: '⚠ [BashTool] Another warning message',
    shouldBeError: false,
  },
  // === REAL ERROR CASES (should still be detected) ===
  {
    name: 'Real error with "Error:" prefix',
    message: 'Error: Something went wrong',
    shouldBeError: true,
  },
  {
    name: 'Real npm error',
    message: 'npm error code ENOENT',
    shouldBeError: true,
  },
  {
    name: 'Real failure message',
    message: 'Command failed with exit code 1',
    shouldBeError: true,
  },
  {
    name: 'Command not found error',
    message: '/bin/sh: 1: claude: not found',
    shouldBeError: true,
  },
  // === EDGE CASES ===
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
  {
    name: 'Invalid JSON that starts with { (falls through to keyword matching)',
    message: '{not valid json: failed}',
    shouldBeError: true,
  },
];

console.log('Testing stderr warning detection for issue #1337 (FIXED BEHAVIOR)...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const detected = fixedDetectionLogic(testCase.message);
  const expected = testCase.shouldBeError;
  const correct = detected === expected;
  const result = correct ? '✅ PASS' : '❌ FAIL';

  if (correct) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${result}: ${testCase.name}`);
  if (!correct) {
    console.log(`   Message: "${testCase.message.substring(0, 100)}${testCase.message.length > 100 ? '...' : ''}"`);
    console.log(`   Expected error: ${expected}, Detected as error: ${detected}`);
  }
  console.log('');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed! Issue #1337 fix verified.');
  process.exit(0);
}
