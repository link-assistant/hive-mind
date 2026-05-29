#!/usr/bin/env node
// Test file for issue #1834: Corrupted extended-thinking blocks make a Claude Code
// session permanently un-resumable.
//
// Error reproduced from the issue:
//   API Error: 400 messages.1.content.19: `thinking` or `redacted_thinking` blocks
//   in the latest assistant message cannot be modified. These blocks must remain as
//   they were in the original response.
//
// Root cause (upstream anthropics/claude-code#63147): when extended thinking is
// combined with tool use, Claude Code persists a thinking block to the on-disk
// session transcript with the `thinking` text emptied to "" while keeping the
// original `signature`. On resume the API validates the signature against the now
// empty text and rejects every subsequent turn with a 400. The only recovery is to
// discard the session and start fresh, so classifyRetryableError flags the error
// with `requiresFreshSession: true` (NOT plain `isRetryable`, which would resume the
// same corrupted session forever).

import assert from 'assert';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const { classifyRetryableError } = await import('../src/tool-retry.lib.mjs');
const { retryLimits, criticalErrorRecovery } = await import('../src/config.lib.mjs');
const { createThinkingBlockRecovery } = await import('../src/claude.thinking-block-recovery.lib.mjs');
const { commitUncommittedChangesOnCriticalError } = await import('../src/critical-error-commit.lib.mjs');
const { repairCorruptedThinkingBlocks, resolveSessionTranscriptPath } = await import('../src/claude.session-transcript-repair.lib.mjs');

console.log('Testing Corrupted Thinking-Block Recovery (Issue #1834)\n');

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

// A noop async logger and a scriptable command-stream `$` double for the behavioral tests.
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

// The exact message from the issue gist log (req_011CbVfZ3PnFwVTwDXLGCBuW).
const issueMessage = 'API Error: 400 messages.1.content.19: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.';

test('Flags the issue #1834 message as requiresFreshSession', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.requiresFreshSession, true, `Expected requiresFreshSession=true, got: ${result.requiresFreshSession}`);
});

test('Does NOT mark the corrupted-thinking error as plain isRetryable', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.isRetryable, false, 'Corrupted thinking blocks must not use the resume-retry path (would loop forever)');
});

test('Is not classified as a capacity error', () => {
  const result = classifyRetryableError(issueMessage);
  assert.strictEqual(result.isCapacity, false, 'Corrupted thinking blocks are not a capacity error');
});

test('Provides a descriptive label', () => {
  const result = classifyRetryableError(issueMessage);
  assert(typeof result.label === 'string' && result.label.length > 0, 'Should provide a human-readable label');
  assert(result.label.toLowerCase().includes('thinking'), `Label should mention thinking blocks, got: ${result.label}`);
});

test('Detects redacted_thinking variant', () => {
  const msg = 'API Error: 400 messages.2.content.5: `redacted_thinking` blocks in the latest assistant message cannot be modified.';
  const result = classifyRetryableError(msg);
  assert.strictEqual(result.requiresFreshSession, true, 'redacted_thinking variant should also require a fresh session');
});

test('Detection is case-insensitive', () => {
  const result = classifyRetryableError(issueMessage.toUpperCase());
  assert.strictEqual(result.requiresFreshSession, true, 'Detection should be case-insensitive');
});

test('Accepts a structured error object (not just a string)', () => {
  const errObj = {
    error: {
      message: '`thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.',
    },
  };
  const result = classifyRetryableError(errObj);
  assert.strictEqual(result.requiresFreshSession, true, 'Should normalize and detect structured error objects');
});

// ============================================================
// Section 2: No false positives
// ============================================================
console.log('\n=== 2. No false positives ===');

test('Plain mention of "thinking" is not flagged', () => {
  const result = classifyRetryableError('I am thinking about the solution.');
  assert(!result.requiresFreshSession, 'Casual mention of thinking must not trigger fresh-session recovery');
});

test('"cannot be modified" without thinking context is not flagged', () => {
  const result = classifyRetryableError('This file cannot be modified because it is read-only.');
  assert(!result.requiresFreshSession, 'Unrelated "cannot be modified" must not trigger fresh-session recovery');
});

test('Transient errors are unaffected (still isRetryable, no fresh session)', () => {
  const overloaded = classifyRetryableError('API Error: 500 {"type":"error","error":{"type":"api_error","message":"Overloaded"}}');
  assert.strictEqual(overloaded.isRetryable, true, 'Overloaded should remain retryable');
  assert(!overloaded.requiresFreshSession, 'Overloaded must not require a fresh session');

  const e503 = classifyRetryableError('API Error: 503 upstream connect error');
  assert.strictEqual(e503.isRetryable, true, '503 should remain retryable');
  assert(!e503.requiresFreshSession, '503 must not require a fresh session');
});

test('Unknown errors return the default (non-retryable, no fresh session)', () => {
  const result = classifyRetryableError('Some unrelated failure');
  assert.strictEqual(result.isRetryable, false, 'Unknown error should not be retryable');
  assert(!result.requiresFreshSession, 'Unknown error should not require a fresh session');
});

// ============================================================
// Section 3: Restart-cap configuration
// ============================================================
console.log('\n=== 3. Fresh-session restart cap (Issue #1834) ===');

test('retryLimits.maxThinkingBlockRestarts is defined', () => {
  assert(typeof retryLimits.maxThinkingBlockRestarts === 'number', `maxThinkingBlockRestarts should be a number, got: ${typeof retryLimits.maxThinkingBlockRestarts}`);
});

test('maxThinkingBlockRestarts defaults to 2', () => {
  // Default value (overridable via HIVE_MIND_MAX_THINKING_BLOCK_RESTARTS).
  assert.strictEqual(retryLimits.maxThinkingBlockRestarts, 2, `Expected default 2, got: ${retryLimits.maxThinkingBlockRestarts}`);
});

test('maxThinkingBlockRestarts is a small positive bound (prevents endless restart loop)', () => {
  assert(retryLimits.maxThinkingBlockRestarts > 0, 'Must allow at least one fresh-session restart');
  assert(retryLimits.maxThinkingBlockRestarts <= 5, 'Must remain a small cap to avoid endless restart loops');
});

// ============================================================
// Section 3b: Resume-cap configuration (PR #1835: "try resume first")
// ============================================================
console.log('\n=== 3b. Resume-first cap (Issue #1834 / PR #1835 feedback) ===');

test('retryLimits.maxThinkingBlockResumes is defined', () => {
  assert(typeof retryLimits.maxThinkingBlockResumes === 'number', `maxThinkingBlockResumes should be a number, got: ${typeof retryLimits.maxThinkingBlockResumes}`);
});

test('maxThinkingBlockResumes defaults to 1 (resume is tried first, but only briefly)', () => {
  // Default value (overridable via HIVE_MIND_MAX_THINKING_BLOCK_RESUMES).
  assert.strictEqual(retryLimits.maxThinkingBlockResumes, 1, `Expected default 1, got: ${retryLimits.maxThinkingBlockResumes}`);
});

test('maxThinkingBlockResumes is a small positive bound (resume rarely succeeds for this error)', () => {
  assert(retryLimits.maxThinkingBlockResumes > 0, 'Must allow at least one resume attempt (resume-first)');
  assert(retryLimits.maxThinkingBlockResumes <= 5, 'Must remain a small cap to avoid endless resume loops');
});

// ============================================================
// Section 3c: Auto-commit-on-critical-error configuration
// ============================================================
console.log('\n=== 3c. Auto-commit on critical errors (PR #1835 feedback) ===');

test('criticalErrorRecovery.autoCommitUncommittedChanges is defined', () => {
  assert(typeof criticalErrorRecovery.autoCommitUncommittedChanges === 'boolean', `Expected a boolean, got: ${typeof criticalErrorRecovery.autoCommitUncommittedChanges}`);
});

test('autoCommitUncommittedChanges defaults to true (preserve work by default)', () => {
  // "on all critical errors we auto commit uncommitted changes by default"
  assert.strictEqual(criticalErrorRecovery.autoCommitUncommittedChanges, true, 'Auto-commit must be ON by default');
});

// ============================================================
// Section 4: Recovery escalation — resume FIRST, then fresh restart
// ============================================================
console.log('\n=== 4. Recovery escalation: resume-first then restart ===');

const classified = classifyRetryableError(issueMessage);

await testAsync('First attempt resumes the existing session (does not discard it)', async () => {
  const argv = {};
  const recover = createThinkingBlockRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
  });
  const proceed = await recover({ classified, source: 'result', sessionId: 'sess-abc' });
  assert.strictEqual(proceed, true, 'Recovery should signal the caller to retry');
  assert.strictEqual(argv.resume, 'sess-abc', 'Phase 1 must RESUME the existing session id first');
});

await testAsync('After the resume cap, it discards the session and restarts fresh', async () => {
  const argv = {};
  const recover = createThinkingBlockRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
  });
  // 1 resume (default cap) then fall through to fresh restart on the next invocation.
  await recover({ classified, source: 'result', sessionId: 'sess-abc' });
  const proceed = await recover({ classified, source: 'result', sessionId: 'sess-abc' });
  assert.strictEqual(proceed, true, 'Restart phase should still signal retry');
  assert.strictEqual(argv.resume, undefined, 'Phase 2 must CLEAR argv.resume to force a fresh session');
});

await testAsync('Eventually gives up after resume + restart caps are exhausted', async () => {
  const argv = {};
  const recover = createThinkingBlockRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
  });
  // Defaults: 1 resume + 2 restarts = 3 successful attempts, then failure.
  const total = retryLimits.maxThinkingBlockResumes + retryLimits.maxThinkingBlockRestarts;
  for (let i = 0; i < total; i++) {
    const proceed = await recover({ classified, source: 'result', sessionId: 'sess-abc' });
    assert.strictEqual(proceed, true, `Attempt ${i + 1} should still proceed`);
  }
  const giveUp = await recover({ classified, source: 'result', sessionId: 'sess-abc' });
  assert.strictEqual(giveUp, false, 'After all caps are exhausted, recovery must fail (no endless loop)');
});

await testAsync('Without a session id it skips resume and goes straight to a fresh restart', async () => {
  const argv = {};
  const recover = createThinkingBlockRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
  });
  const proceed = await recover({ classified, source: 'result', sessionId: null });
  assert.strictEqual(proceed, true, 'Should still proceed with a fresh restart');
  assert.strictEqual(argv.resume, undefined, 'No session id → fresh restart, argv.resume stays cleared');
});

// ============================================================
// Section 5: Auto-commit helper preserves uncommitted work
// ============================================================
console.log('\n=== 5. commitUncommittedChangesOnCriticalError ===');

await testAsync('Commits and pushes when there are uncommitted changes', async () => {
  const fake$ = makeFake$(' M src/foo.mjs');
  const result = await commitUncommittedChangesOnCriticalError({
    tempDir: '/tmp/none',
    branchName: 'my-branch',
    $: fake$,
    log: noopLog,
    reason: 'unit-test',
  });
  assert.strictEqual(result.committed, true, 'Should commit when the tree is dirty');
  assert.strictEqual(result.pushed, true, 'Should push the preserved work');
  assert(
    fake$.calls.some(c => c.includes('git add')),
    'Should stage changes'
  );
  assert(
    fake$.calls.some(c => c.includes('git commit')),
    'Should commit changes'
  );
  assert(
    fake$.calls.some(c => c.includes('git push')),
    'Should push changes'
  );
});

await testAsync('No-ops cleanly when the working tree is clean', async () => {
  const fake$ = makeFake$('');
  const result = await commitUncommittedChangesOnCriticalError({
    tempDir: '/tmp/none',
    branchName: 'my-branch',
    $: fake$,
    log: noopLog,
  });
  assert.strictEqual(result.committed, false, 'Nothing to commit on a clean tree');
  assert(!fake$.calls.some(c => c.includes('git commit')), 'Must not commit on a clean tree');
});

await testAsync('Never throws and returns a safe result when misconfigured', async () => {
  const result = await commitUncommittedChangesOnCriticalError({ tempDir: '', $: undefined, log: noopLog });
  assert.deepStrictEqual(result, { committed: false, pushed: false }, 'Must degrade gracefully without a working tree/$');
});

// ============================================================
// Section 6: Transcript repair (Issue #1834 "can we do even better?")
// ============================================================
console.log('\n=== 6. repairCorruptedThinkingBlocks ===');

// Build an isolated fake ~/.claude/projects tree and a session JSONL inside it, then return the
// (homeDir, tempDir, sessionId) needed to drive the repair. The transcript reproduces the exact
// corruption from the issue log: an assistant message whose thinking block has empty text but a
// kept signature.
const writeFakeSession = async lines => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue1834-home-'));
  const tempDir = '/tmp/some-work-dir';
  const sessionId = 'sess-repair-test';
  const sessionFile = resolveSessionTranscriptPath(tempDir, sessionId, homeDir);
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(sessionFile, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'), 'utf8');
  return { homeDir, tempDir, sessionId, sessionFile };
};

await testAsync('Strips an empty-text thinking block but keeps the rest of the message', async () => {
  const corruptedEntry = {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'EucBCmMIstale-signature' },
        { type: 'text', text: 'Here is my answer.' },
      ],
    },
  };
  const { homeDir, tempDir, sessionId, sessionFile } = await writeFakeSession([corruptedEntry]);
  const result = await repairCorruptedThinkingBlocks({ tempDir, sessionId, homeDir, log: noopLog });
  assert.strictEqual(result.repaired, true, 'Should report a repair was made');
  assert.strictEqual(result.removedBlocks, 1, 'Should remove exactly the 1 corrupted block');
  const repaired = JSON.parse((await fs.readFile(sessionFile, 'utf8')).trim());
  assert.strictEqual(repaired.message.content.length, 1, 'Only the text block should remain');
  assert.strictEqual(repaired.message.content[0].type, 'text', 'The surviving block must be the text block');
});

await testAsync('Writes a one-time .pre-repair-backup of the original transcript', async () => {
  const { homeDir, tempDir, sessionId, sessionFile } = await writeFakeSession([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'text', text: 'hi' },
        ],
      },
    },
  ]);
  const original = await fs.readFile(sessionFile, 'utf8');
  await repairCorruptedThinkingBlocks({ tempDir, sessionId, homeDir, log: noopLog });
  const backup = await fs.readFile(`${sessionFile}.pre-repair-backup`, 'utf8');
  assert.strictEqual(backup, original, 'Backup must contain the unmodified original transcript');
});

await testAsync('Removes redacted_thinking blocks with empty data', async () => {
  const { homeDir, tempDir, sessionId, sessionFile } = await writeFakeSession([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'redacted_thinking', data: '' },
          { type: 'text', text: 'ok' },
        ],
      },
    },
  ]);
  const result = await repairCorruptedThinkingBlocks({ tempDir, sessionId, homeDir, log: noopLog });
  assert.strictEqual(result.removedBlocks, 1, 'Should remove the empty redacted_thinking block');
  const repaired = JSON.parse((await fs.readFile(sessionFile, 'utf8')).trim());
  assert.strictEqual(repaired.message.content.length, 1, 'Only the text block should remain');
});

await testAsync('Leaves a valid (signed, non-empty) thinking block untouched', async () => {
  const { homeDir, tempDir, sessionId, sessionFile } = await writeFakeSession([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'real reasoning', signature: 'sig' },
          { type: 'text', text: 'answer' },
        ],
      },
    },
  ]);
  const before = await fs.readFile(sessionFile, 'utf8');
  const result = await repairCorruptedThinkingBlocks({ tempDir, sessionId, homeDir, log: noopLog });
  assert.strictEqual(result.repaired, false, 'A healthy transcript must not be modified');
  assert.strictEqual(result.removedBlocks, 0, 'Nothing should be removed from a healthy transcript');
  assert.strictEqual(await fs.readFile(sessionFile, 'utf8'), before, 'A healthy transcript must be byte-identical after repair');
});

await testAsync('Never empties a message: a thinking-only message is left as-is', async () => {
  const { homeDir, tempDir, sessionId, sessionFile } = await writeFakeSession([{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }] } }]);
  const before = await fs.readFile(sessionFile, 'utf8');
  const result = await repairCorruptedThinkingBlocks({ tempDir, sessionId, homeDir, log: noopLog });
  assert.strictEqual(result.repaired, false, 'Must not produce an empty content array');
  assert.strictEqual(await fs.readFile(sessionFile, 'utf8'), before, 'Message must be left unchanged to avoid an invalid empty content array');
});

await testAsync('Returns gracefully (no throw) when the transcript does not exist', async () => {
  const result = await repairCorruptedThinkingBlocks({ tempDir: '/tmp/none', sessionId: 'does-not-exist', homeDir: '/tmp/none', log: noopLog });
  assert.strictEqual(result.repaired, false, 'Missing transcript must not be reported as repaired');
  assert.strictEqual(result.removedBlocks, 0, 'Missing transcript removes nothing');
});

await testAsync('Returns gracefully when called with no arguments', async () => {
  const result = await repairCorruptedThinkingBlocks();
  assert.strictEqual(result.repaired, false, 'Must degrade gracefully with no opts');
});

// ============================================================
// Section 7: Phase 1 repairs the transcript before resuming
// ============================================================
console.log('\n=== 7. Recovery Phase 1 repairs then resumes ===');

await testAsync('Phase 1 invokes transcript repair before setting argv.resume', async () => {
  const argv = {};
  let repairCalledWith = null;
  const recover = createThinkingBlockRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
    repair: async opts => {
      repairCalledWith = opts;
      return { repaired: true, removedBlocks: 3 };
    },
  });
  const proceed = await recover({ classified, source: 'result', sessionId: 'sess-xyz' });
  assert.strictEqual(proceed, true, 'Recovery should signal retry');
  assert.strictEqual(argv.resume, 'sess-xyz', 'Phase 1 must resume the existing session after repair');
  assert(repairCalledWith, 'Repair must be invoked in Phase 1');
  assert.strictEqual(repairCalledWith.sessionId, 'sess-xyz', 'Repair must target the failing session id');
});

await testAsync('Phase 1 still resumes even if repair throws (repair must never block recovery)', async () => {
  const argv = {};
  const recover = createThinkingBlockRecovery({
    argv,
    tempDir: '/tmp/none',
    branchName: 'b',
    $: makeFake$(''),
    log: noopLog,
    waitMs: 0,
    repair: async () => {
      throw new Error('boom');
    },
  });
  const proceed = await recover({ classified, source: 'result', sessionId: 'sess-xyz' });
  assert.strictEqual(proceed, true, 'A repair failure must not abort recovery');
  assert.strictEqual(argv.resume, 'sess-xyz', 'Phase 1 must still resume after a failed repair');
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
