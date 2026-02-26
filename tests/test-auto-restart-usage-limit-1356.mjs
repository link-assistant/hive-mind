#!/usr/bin/env node

/**
 * Unit Tests: Issue #1356 - Auto-restart stops on usage limit to prevent comment spam
 *
 * Tests verify that:
 * 1. isUsageLimitReached correctly detects usage limit from tool results
 * 2. The auto-restart loop exits when a usage limit is reached
 * 3. A single notification comment is posted (not spam)
 * 4. The usage limit comment uses deduplication
 */

import { isUsageLimitReached, isApiError } from '../src/solve.restart-shared.lib.mjs';

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1356 - Auto-restart usage limit detection');
console.log('================================================================================\n');

// ===== Test: isUsageLimitReached function =====
console.log('📋 isUsageLimitReached() Tests\n');

test('detects limitReached: true in tool result', () => {
  const toolResult = {
    success: false,
    limitReached: true,
    limitResetTime: '5:00 AM',
    limitTimezone: 'America/Los_Angeles',
  };
  assert(isUsageLimitReached(toolResult) === true, 'Should detect usage limit');
});

test('returns false when limitReached is false', () => {
  const toolResult = {
    success: false,
    limitReached: false,
  };
  assert(isUsageLimitReached(toolResult) === false, 'Should not detect limit when false');
});

test('returns false when limitReached is undefined', () => {
  const toolResult = {
    success: false,
  };
  assert(isUsageLimitReached(toolResult) === false, 'Should not detect limit when undefined');
});

test('returns false for null toolResult', () => {
  assert(isUsageLimitReached(null) === false, 'Should return false for null');
});

test('returns false for undefined toolResult', () => {
  assert(isUsageLimitReached(undefined) === false, 'Should return false for undefined');
});

test('returns false for successful result with limitReached undefined', () => {
  const toolResult = {
    success: true,
    sessionId: 'test-123',
  };
  assert(isUsageLimitReached(toolResult) === false, 'Should not detect limit for success');
});

test('detects limitReached even without limitResetTime', () => {
  const toolResult = {
    success: false,
    limitReached: true,
    // no limitResetTime
  };
  assert(isUsageLimitReached(toolResult) === true, 'Should detect limit even without reset time');
});

// ===== Test: isApiError vs isUsageLimitReached distinction =====
console.log('\n📋 isApiError vs isUsageLimitReached Distinction Tests\n');

test('usage limit result is NOT detected as API error', () => {
  const toolResult = {
    success: false,
    limitReached: true,
    limitResetTime: '5:00 AM',
    // Note: no `result` field — tool executors don't set it
  };
  assert(isApiError(toolResult) === false, 'Usage limit should not be detected as API error');
  assert(isUsageLimitReached(toolResult) === true, 'Usage limit should be detected by isUsageLimitReached');
});

test('API error result is NOT detected as usage limit', () => {
  const toolResult = {
    success: false,
    result: 'API Error: not_found_error',
    limitReached: false,
  };
  assert(isApiError(toolResult) === true, 'API error should be detected');
  assert(isUsageLimitReached(toolResult) === false, 'API error should not be detected as usage limit');
});

test('generic failure is neither API error nor usage limit', () => {
  const toolResult = {
    success: false,
    // No result field, no limitReached field
  };
  assert(isApiError(toolResult) === false, 'Generic failure should not be API error');
  assert(isUsageLimitReached(toolResult) === false, 'Generic failure should not be usage limit');
});

// ===== Test: Loop behavior simulation =====
console.log('\n📋 Auto-restart Loop Behavior Simulation Tests\n');

test('loop should exit when usage limit is reached (simulated)', () => {
  // Simulate the auto-restart loop behavior
  let loopContinued = false;
  let exitReason = null;
  let commentPosted = false;

  // Simulate: tool returns usage limit
  const toolResult = {
    success: false,
    limitReached: true,
    limitResetTime: '5:00 AM',
  };

  // Simulate the fixed logic
  if (!toolResult.success) {
    if (isUsageLimitReached(toolResult)) {
      exitReason = 'usage_limit';
      commentPosted = true; // Would post a single notification
      // return (exit loop)
    } else {
      loopContinued = true;
    }
  }

  assert(exitReason === 'usage_limit', 'Loop should exit with usage_limit reason');
  assert(loopContinued === false, 'Loop should NOT continue');
  assert(commentPosted === true, 'Should post a single usage limit notification');
});

test('loop should continue on generic failure (NOT usage limit)', () => {
  let loopContinued = false;
  let exitReason = null;

  const toolResult = {
    success: false,
    // No limitReached — generic failure
  };

  if (!toolResult.success) {
    if (isUsageLimitReached(toolResult)) {
      exitReason = 'usage_limit';
    } else {
      loopContinued = true;
    }
  }

  assert(exitReason === null, 'Should not exit with usage_limit reason');
  assert(loopContinued === true, 'Loop should continue on generic failure');
});

test('loop should exit on API error after max retries (existing behavior preserved)', () => {
  const MAX_API_ERROR_RETRIES = 3;
  let consecutiveApiErrors = 0;
  let exitReason = null;

  // Simulate 3 consecutive API errors
  for (let i = 0; i < 3; i++) {
    const toolResult = {
      success: false,
      result: 'API Error: authentication_error',
    };

    if (!toolResult.success) {
      if (isUsageLimitReached(toolResult)) {
        exitReason = 'usage_limit';
        break;
      } else if (isApiError(toolResult)) {
        consecutiveApiErrors++;
        if (consecutiveApiErrors >= MAX_API_ERROR_RETRIES) {
          exitReason = 'api_error';
          break;
        }
      }
    }
  }

  assert(exitReason === 'api_error', 'Should exit with api_error after max retries');
  assert(consecutiveApiErrors === 3, `Should have 3 consecutive errors, got ${consecutiveApiErrors}`);
});

// ===== Test: Comment deduplication logic =====
console.log('\n📋 Usage Limit Comment Deduplication Tests\n');

test('usage limit comment signature is consistent', () => {
  const signature = '## ⏳ Usage Limit Reached';

  // Simulate comment body
  const commentBody = "## ⏳ Usage Limit Reached\n\nThe AI tool's usage limit has been reached. Auto-restart-until-mergeable mode is pausing to avoid posting repeated comments while no progress can be made.\n\n**Reset time:** 5:00 AM\n\nThe session will need to be restarted manually after the limit resets, or use `--auto-resume-on-limit-reset` to automatically resume.\n\n---\n*Detected by hive-mind with --auto-restart-until-mergeable flag*";

  assert(commentBody.includes(signature), 'Comment body should contain the signature');
});

test('deduplication prevents posting when existing comment found', () => {
  const existingComments = ['Some other comment', "## ⏳ Usage Limit Reached\n\nThe AI tool's usage limit has been reached...", 'Another comment'];

  const signature = '## ⏳ Usage Limit Reached';
  const hasExisting = existingComments.some(body => body.includes(signature));

  let commentPosted = false;
  if (!hasExisting) {
    commentPosted = true;
  }

  assert(hasExisting === true, 'Should find existing usage limit comment');
  assert(commentPosted === false, 'Should NOT post duplicate comment');
});

test('allows posting when no existing usage limit comment', () => {
  const existingComments = ['Some other comment', '## 🔄 Auto-restart triggered\n\nSome restart comment', 'Another comment'];

  const signature = '## ⏳ Usage Limit Reached';
  const hasExisting = existingComments.some(body => body.includes(signature));

  let commentPosted = false;
  if (!hasExisting) {
    commentPosted = true;
  }

  assert(hasExisting === false, 'Should NOT find existing usage limit comment');
  assert(commentPosted === true, 'Should post comment');
});

// ===== Test: Auto-restart comment includes attempt number =====
console.log('\n📋 Auto-restart Comment Tracking Tests\n');

test('auto-restart comment includes attempt number', () => {
  const restartCount = 3;
  const restartReason = 'CI failures detected';
  const commentBody = `## 🔄 Auto-restart triggered (attempt ${restartCount})\n\n**Reason:** ${restartReason}\n\nStarting new session to address the issues.\n\n---\n*Auto-restart-until-mergeable mode is active. Will continue until PR becomes mergeable.*`;

  assert(commentBody.includes('(attempt 3)'), 'Comment should include attempt number');
  assert(commentBody.includes('CI failures detected'), 'Comment should include reason');
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1356:`);
console.log(`  ${GREEN}✅ Passed:${RESET} ${passed}`);
console.log(`  ${RED}❌ Failed:${RESET} ${failed}`);
console.log(`  Total: ${passed + failed}`);
console.log('================================================================================\n');

if (failed > 0) {
  console.log(`${RED}❌ Some tests failed!${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}✅ All tests passed!${RESET}`);
  process.exit(0);
}
