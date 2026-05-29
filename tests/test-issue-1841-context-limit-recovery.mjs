#!/usr/bin/env node
// Test file for issue #1841: "Prompt is too long" — Claude Code's context window is exhausted and
// its built-in auto-compaction fails to reduce the prompt, so a headless `solve` run aborts.
//
// Failure reproduced from the issue gist log (session 88c9c3b2-a155-4b1b-8a88-afdcffd31beb):
//   { type: 'system', subtype: 'status', status: 'compacting' }
//   { type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'too_few_groups' }
//   { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Prompt is too long' }] }, error: 'invalid_request' }
//   { type: 'result', subtype: 'success', is_error: true, result: 'Prompt is too long', terminal_reason: 'blocking_limit', usage: { output_tokens: 125310 } }
//   → exit code 1
//
// Root cause (upstream anthropics/claude-code#46348, #23751, #26317): auto-compaction normally
// prevents "Prompt is too long", but it summarizes the transcript with a smaller-context model and
// can itself overflow / refuse (`too_few_groups` — typically one oversized turn dominating the
// window, here a 125k-token final turn). In headless/`-p` mode the transcript only grows, so
// resuming the SAME session replays the oversized prompt and fails forever. The only recovery is a
// fresh session (equivalent to `/clear`). classifyRetryableError therefore flags it with
// `requiresFreshSession: true` AND `isContextLimit: true` so the caller routes it to the
// context-limit recovery (fresh restart) rather than the thinking-block recovery (resume-first).

import assert from 'assert';

const { classifyRetryableError } = await import('../src/tool-retry.lib.mjs');
const { retryLimits, criticalErrorRecovery } = await import('../src/config.lib.mjs');
const { createContextLimitRecovery } = await import('../src/claude.context-limit-recovery.lib.mjs');

console.log('Testing "Prompt is too long" / Context-Limit Recovery (Issue #1841)\n');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
};

const testAsync = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
};

const noopLog = async () => {};
const makeFake$ = (statusOutput = '') => {
  const calls = [];
  const fake = () => async strings => {
    const cmd = strings.join(' ');
    calls.push(cmd);
    if (cmd.includes('git status')) return { code: 0, stdout: statusOutput, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  fake.calls = calls;
  return fake;
};

// ============================================================
// Section 1: Error classification
// ============================================================
console.log('\n=== 1. classifyRetryableError detection ===');

// The exact message from the issue gist log.
const issueMessage = 'Prompt is too long';

test('Flags "Prompt is too long" as requiresFreshSession', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.requiresFreshSession, true, `Expected requiresFreshSession=true, got: ${result.requiresFreshSession}`);
});

test('Flags "Prompt is too long" with isContextLimit=true', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.isContextLimit, true, `Expected isContextLimit=true, got: ${result.isContextLimit}`);
});

test('Does NOT mark the context-limit error as plain isRetryable', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.isRetryable, false, 'Context-limit must not use the transient resume-retry path (would loop forever)');
});

test('Is not classified as a capacity error', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.isCapacity, false, 'Context-limit is not a capacity error');
});

test('Provides a descriptive label mentioning the context window', () => {
  const result = classifyRetryableError(issueMessage);
  assert(typeof result.label === 'string' && result.label.length > 0, 'Should provide a human-readable label');
  assert(result.label.toLowerCase().includes('prompt is too long'), `Label should mention the error, got: ${result.label}`);
});

test('Detection is case-insensitive', () => {
  const result = classifyRetryableError('PROMPT IS TOO LONG');
  assert.strictEqual(result.isContextLimit, true, 'Detection should be case-insensitive');
});

test('Detects the "input is too long" variant', () => {
  const result = classifyRetryableError('API Error: 400 input is too long for requested model');
  assert.strictEqual(result.isContextLimit, true, 'The "input is too long" variant should also be flagged');
});

test('Accepts a structured error object (not just a string)', () => {
  const result = classifyRetryableError({ error: { message: 'Prompt is too long' } });
  assert.strictEqual(result.isContextLimit, true, 'Should normalize and detect structured error objects');
});

test('Accepts the synthetic result shape ({ result: "Prompt is too long" })', () => {
  // claude.lib.mjs sets lastMessage = data.result for is_error results.
  const result = classifyRetryableError('Prompt is too long');
  assert.strictEqual(result.requiresFreshSession, true, 'The result string from the failing run must be detected');
});

// ============================================================
// Section 2: No false positives / routing separation from thinking-block recovery
// ============================================================
console.log('\n=== 2. No false positives & recovery routing ===');

test('Casual mention of a long prompt is not flagged', () => {
  const result = classifyRetryableError('The prompt was a bit long but it worked fine.');
  assert(!result.isContextLimit, 'Casual mention must not trigger context-limit recovery');
});

test('Context-limit error is NOT routed to thinking-block recovery', () => {
  const result = classifyRetryableError(issueMessage);
  // Both set requiresFreshSession, but the caller guards thinking-block recovery with
  // `!isContextLimit`, so isContextLimit is the discriminator.
  assert.strictEqual(result.isContextLimit, true, 'Context-limit must be distinguishable from thinking-block via isContextLimit');
});

test('Corrupted-thinking error is NOT flagged as context-limit', () => {
  const thinking = classifyRetryableError('`thinking` blocks in the latest assistant message cannot be modified.');
  assert.strictEqual(thinking.requiresFreshSession, true, 'Thinking-block error still requires fresh session');
  assert(!thinking.isContextLimit, 'Thinking-block error must NOT be flagged as context-limit (different recovery)');
});

test('Transient errors are unaffected', () => {
  const overloaded = classifyRetryableError('API Error: 500 {"type":"error","error":{"type":"api_error","message":"Overloaded"}}');
  assert.strictEqual(overloaded.isRetryable, true, 'Overloaded should remain retryable');
  assert(!overloaded.isContextLimit, 'Overloaded must not be flagged as context-limit');
});

test('Unknown errors return the default (non-retryable, no fresh session, no context-limit)', () => {
  const result = classifyRetryableError('Some unrelated failure');
  assert.strictEqual(result.isRetryable, false, 'Unknown error should not be retryable');
  assert(!result.requiresFreshSession, 'Unknown error should not require a fresh session');
  assert(!result.isContextLimit, 'Unknown error should not be flagged as context-limit');
});

// ============================================================
// Section 3: Restart-cap configuration
// ============================================================
console.log('\n=== 3. Fresh-session restart cap (Issue #1841) ===');

test('retryLimits.maxContextLimitRestarts is defined', () => {
  assert(typeof retryLimits.maxContextLimitRestarts === 'number', `maxContextLimitRestarts should be a number, got: ${typeof retryLimits.maxContextLimitRestarts}`);
});

test('maxContextLimitRestarts defaults to 1', () => {
  assert.strictEqual(retryLimits.maxContextLimitRestarts, 1, `Expected default 1, got: ${retryLimits.maxContextLimitRestarts}`);
});

test('maxContextLimitRestarts is a small positive bound (prevents endless restart loop)', () => {
  assert(retryLimits.maxContextLimitRestarts > 0, 'Must allow at least one fresh-session restart');
  assert(retryLimits.maxContextLimitRestarts <= 5, 'Must remain a small cap to avoid endless restart loops');
});

test('Auto-commit on critical errors is ON by default (preserves work before restart)', () => {
  assert.strictEqual(criticalErrorRecovery.autoCommitUncommittedChanges, true, 'Auto-commit must be ON by default');
});

// ============================================================
// Section 4: Recovery behavior — fresh restart only (never resume)
// ============================================================
console.log('\n=== 4. Context-limit recovery: fresh restart only ===');

const classified = classifyRetryableError(issueMessage);

await testAsync('Discards the session and forces a fresh restart (never resumes)', async () => {
  const argv = { resume: 'sess-abc' }; // pretend we were resuming
  const recover = createContextLimitRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
  });
  const proceed = await recover({ classified, source: 'result', sessionId: 'sess-abc' });
  assert.strictEqual(proceed, true, 'Recovery should signal the caller to retry');
  assert.strictEqual(argv.resume, undefined, 'Must CLEAR argv.resume to force a fresh session (resuming replays the over-long prompt)');
});

await testAsync('Auto-commits uncommitted work before restarting', async () => {
  const argv = {};
  const fake$ = makeFake$(' M src/foo.mjs');
  const recover = createContextLimitRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'my-branch',
    $: fake$,
    log: noopLog,
    waitMs: 0,
  });
  await recover({ classified, source: 'result', sessionId: 'sess-abc' });
  assert(
    fake$.calls.some(c => c.includes('git add')),
    'Should stage uncommitted work before restart'
  );
  assert(
    fake$.calls.some(c => c.includes('git commit')),
    'Should commit uncommitted work before restart'
  );
});

await testAsync('Gives up after the restart cap is exhausted (no endless loop)', async () => {
  const argv = {};
  const recover = createContextLimitRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
  });
  for (let i = 0; i < retryLimits.maxContextLimitRestarts; i++) {
    const proceed = await recover({ classified, source: 'result', sessionId: 'sess-abc' });
    assert.strictEqual(proceed, true, `Restart ${i + 1} should still proceed`);
  }
  const giveUp = await recover({ classified, source: 'result', sessionId: 'sess-abc' });
  assert.strictEqual(giveUp, false, 'After the restart cap is exhausted, recovery must fail (no endless loop)');
});

await testAsync('Works from the exception source too', async () => {
  const argv = { resume: 'sess-xyz' };
  const recover = createContextLimitRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
  });
  const proceed = await recover({ classified, source: 'exception', sessionId: 'sess-xyz' });
  assert.strictEqual(proceed, true, 'Should proceed from the exception path');
  assert.strictEqual(argv.resume, undefined, 'Must clear argv.resume from the exception path too');
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\nSome tests failed!');
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
