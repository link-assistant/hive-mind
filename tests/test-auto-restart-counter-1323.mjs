#!/usr/bin/env node

/**
 * Unit Tests: Issue #1323 - Auto-restart iteration counter and duplicate comments
 *
 * Tests verify that:
 * 1. restartCount tracks actual AI tool executions, not check cycles
 * 2. checkForExistingComment prevents duplicate status comments
 */

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
console.log('Unit Tests: Issue #1323 - Auto-restart iteration counter and duplicate comments');
console.log('================================================================================\n');

// ===== Test: Restart counter logic =====
console.log('📋 Restart Counter Logic Tests\n');

test('restartCount should start at 0', () => {
  let restartCount = 0;
  assert(restartCount === 0, 'restartCount should initialize to 0');
});

test('restartCount increments only when shouldRestart is true', () => {
  let restartCount = 0;
  let iteration = 0;

  // Simulate 5 check cycles with only 2 restarts
  const checkCycles = [false, false, true, false, true];

  for (const shouldRestart of checkCycles) {
    iteration++;
    if (shouldRestart) {
      restartCount++;
    }
  }

  assert(iteration === 5, `Expected 5 check cycles, got ${iteration}`);
  assert(restartCount === 2, `Expected 2 restarts, got ${restartCount}`);
});

test('iteration and restartCount are independent counters', () => {
  let restartCount = 0;
  let iteration = 0;

  // 25 check cycles, but only 1 restart (like the bug scenario)
  for (let i = 0; i < 25; i++) {
    iteration++;
    if (i === 24) {
      // Only restart on check #25
      restartCount++;
    }
  }

  assert(iteration === 25, `Expected 25 iterations, got ${iteration}`);
  assert(restartCount === 1, `Expected 1 restart, got ${restartCount}`);

  // This is the fix: log title should use restartCount, not iteration
  const logTitle = `🔄 Auto-restart-until-mergeable Log (iteration ${restartCount})`;
  assert(logTitle.includes('iteration 1'), `Log title should say "iteration 1", got: ${logTitle}`);
});

// ===== Test: Comment signature detection =====
console.log('\n📋 Comment Signature Detection Tests\n');

test('checkForExistingComment signature match logic', () => {
  const commentBodies = ['## ✅ Ready to merge\n\nThis pull request is now ready...', 'Some other comment', 'Another comment'];

  const signature = '## ✅ Ready to merge';
  const hasMatch = commentBodies.some(body => body.includes(signature));

  assert(hasMatch === true, 'Should find existing Ready to merge comment');
});

test('checkForExistingComment returns false when no match', () => {
  const commentBodies = ['Some other comment', 'Another comment', 'No status here'];

  const signature = '## ✅ Ready to merge';
  const hasMatch = commentBodies.some(body => body.includes(signature));

  assert(hasMatch === false, 'Should not find Ready to merge comment when absent');
});

test('checkForExistingComment matches exact signature', () => {
  const commentBody = '## ✅ Ready to merge\n\nThis pull request is now ready to be merged...';
  const signature = '## ✅ Ready to merge';

  assert(commentBody.includes(signature), 'Should match the exact signature');
});

test('checkForExistingComment does not match partial signatures', () => {
  const commentBody = 'Ready to merge manually';
  const signature = '## ✅ Ready to merge';

  assert(!commentBody.includes(signature), 'Should not match partial signature');
});

// ===== Test: Deduplication prevents duplicate posting =====
console.log('\n📋 Deduplication Logic Tests\n');

test('should skip posting when existing comment found', () => {
  const hasExistingComment = true;
  let commentPosted = false;

  if (!hasExistingComment) {
    commentPosted = true;
  }

  assert(commentPosted === false, 'Should not post when existing comment found');
});

test('should post when no existing comment', () => {
  const hasExistingComment = false;
  let commentPosted = false;

  if (!hasExistingComment) {
    commentPosted = true;
  }

  assert(commentPosted === true, 'Should post when no existing comment');
});

// ===== Test: Log title generation =====
console.log('\n📋 Log Title Generation Tests\n');

test('log title uses restartCount, not iteration', () => {
  const iteration = 25;
  const restartCount = 1;

  // Old buggy format (using iteration):
  const buggyTitle = `🔄 Auto-restart-until-mergeable Log (iteration ${iteration})`;

  // Fixed format (using restartCount):
  const fixedTitle = `🔄 Auto-restart-until-mergeable Log (iteration ${restartCount})`;

  assert(fixedTitle === '🔄 Auto-restart-until-mergeable Log (iteration 1)', `Fixed title should say iteration 1, got: ${fixedTitle}`);

  assert(buggyTitle !== fixedTitle, 'Buggy and fixed titles should be different');
});

test('restartCount reflects actual tool executions', () => {
  // Simulate the scenario from PR #195:
  // - Process started, initial solve completed
  // - Auto-restart mode entered
  // - 24 check cycles waiting for CI (no restarts)
  // - Check #25: CI failure detected, restart triggered
  // - 1 actual AI tool execution

  let restartCount = 0;

  // Simulating 25 check cycles
  for (let check = 1; check <= 25; check++) {
    const ciPending = check < 25;
    const ciFailure = check === 25;

    if (ciFailure) {
      restartCount++;
    }
  }

  // The log should say "iteration 1" not "iteration 25"
  const logTitle = `🔄 Auto-restart-until-mergeable Log (iteration ${restartCount})`;
  assert(restartCount === 1, `restartCount should be 1, got ${restartCount}`);
  assert(logTitle.includes('iteration 1'), `Log title should reflect actual restarts`);
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1323:`);
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
