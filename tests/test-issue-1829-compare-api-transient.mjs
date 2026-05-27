#!/usr/bin/env node
/**
 * Tests for Issue #1829: "GitHub compare API not ready - cannot create PR safely".
 *
 * Root cause: the auto-PR creation pipeline polls GitHub's compare/diff
 * endpoint (`/repos/{owner}/{repo}/compare/{base}...{head}`) to confirm the
 * pushed commits are visible before calling `gh pr create`. Under heavy load
 * GitHub renders that diff lazily and returns
 *   HTTP 500: {"message":"...","errors":[{"code":"not_available"}]}
 * with the body "this diff is temporarily unavailable due to heavy server
 * load". The readiness gate treated that transient diff-RENDERING failure as
 * "commits not indexed" and aborted the whole solve session with
 *   Error: GitHub compare API not ready - cannot create PR safely
 * even though the branch + commits were already pushed and `gh pr create`
 * (which does not render the full diff) would have succeeded.
 *
 * Fix (two parts):
 *   1. `isTransientCompareApiError` in github-rate-limit.lib.mjs recognises the
 *      "heavy server load" / `not_available` HTTP 500 and the standard 5xx
 *      gateway codes — but NOT 404 (fork mismatch) or a literal "0" (genuinely
 *      0 commits ahead).
 *   2. The compare-API readiness gate in solve.auto-pr.lib.mjs degrades
 *      gracefully: on a purely transient failure it sets `compareReady = true`
 *      and falls through to PR creation, still guarded by branch verification
 *      and the local `git rev-list` commit check.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1829
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isTransientCompareApiError } from '../src/github-rate-limit.lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = join(__dirname, '..', 'src');

let testsPassed = 0;
let testsFailed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.stack || error.message}`);
    testsFailed++;
  }
};

// ----------------------------------------------------------------------------
// isTransientCompareApiError — positive cases
// ----------------------------------------------------------------------------

console.log('\n📋 isTransientCompareApiError detects transient compare failures (issue #1829)\n');

test('detects the verbatim "heavy server load" message', () => {
  // The message GitHub returns from the compare endpoint under load.
  const msg = 'This diff is temporarily unavailable due to heavy server load. Please try again later.';
  assert.equal(isTransientCompareApiError(msg), true);
});

test('detects the gh api HTTP 500 with not_available code', () => {
  const msg = 'gh: HTTP 500: {"message":"Server Error","errors":[{"resource":"Comparison","code":"not_available"}]} (https://api.github.com/repos/o/r/compare/main...feature)';
  assert.equal(isTransientCompareApiError(msg), true);
});

test('detects a bare HTTP 500 from the compare endpoint', () => {
  assert.equal(isTransientCompareApiError('HTTP 500: Internal Server Error'), true);
});

test('detects HTTP 502 / 503 / 504 gateway errors', () => {
  assert.equal(isTransientCompareApiError('HTTP 502: Bad Gateway'), true);
  assert.equal(isTransientCompareApiError('HTTP 503: Service Unavailable'), true);
  assert.equal(isTransientCompareApiError('HTTP 504: Gateway Timeout'), true);
});

test('detects the EXACT verbatim error from the original report (issue #1829)', () => {
  // Reproduced verbatim from the failure log embedded in
  // docs/case-studies/issue-1829/logs/solve-failure-2026-05-27.log:151 —
  // `gh api repos/.../compare/main...issue-15-... 2>&1` printed both the JSON
  // body and the gh wrapper line in a single stdout blob.
  const literal = '{"message":"Server Error: Sorry, this diff is temporarily unavailable due to heavy server load.","errors":[{"resource":"Comparison","field":"diff","code":"not_available"}],"documentation_url":"https://docs.github.com/rest/commits/commits#compare-two-commits","status":"500"}gh: Server Error: Sorry, this diff is temporarily unavailable due to heavy server load. (HTTP 500)';
  assert.equal(isTransientCompareApiError(literal), true);
});

test('detects the error carried in a command-stream-style stderr Buffer', () => {
  // command-stream exposes stdout/stderr as Buffers; collectErrorText must
  // stringify them before pattern matching.
  const err = { message: 'cmd failed', stderr: Buffer.from('HTTP 500: this diff is temporarily unavailable due to heavy server load') };
  assert.equal(isTransientCompareApiError(err), true);
});

// ----------------------------------------------------------------------------
// isTransientCompareApiError — negative cases (must NOT degrade)
// ----------------------------------------------------------------------------

console.log('\n📋 isTransientCompareApiError ignores non-transient cases (issue #1829)\n');

test('returns false for HTTP 404 (fork mismatch must stay fatal)', () => {
  assert.equal(isTransientCompareApiError('HTTP 404: Not Found'), false);
});

test('returns false for a literal "0" (genuinely 0 commits ahead)', () => {
  assert.equal(isTransientCompareApiError('0'), false);
});

test('returns false for a generic non-transient error', () => {
  assert.equal(isTransientCompareApiError('some unexpected programming bug'), false);
});

test('returns false for null / undefined / empty', () => {
  assert.equal(isTransientCompareApiError(null), false);
  assert.equal(isTransientCompareApiError(undefined), false);
  assert.equal(isTransientCompareApiError(''), false);
});

test('returns false for a raw Buffer with no string body (defensive)', () => {
  // A raw Buffer (not wrapped in an object) yields no text; must not crash.
  assert.equal(isTransientCompareApiError(Buffer.from('HTTP 500')), false);
});

// ----------------------------------------------------------------------------
// Source-level guarantees in the auto-PR compare-readiness handler
//
// The "compare API not ready" decision lives in a dedicated module
// (solve.auto-pr-compare-readiness.lib.mjs) so the auto-PR file stays under
// the 1500-line CI cap; the auto-PR file imports and delegates to it.
// ----------------------------------------------------------------------------

console.log('\n📋 compare-readiness handler degrades gracefully on transient compare errors (issue #1829)\n');

const autoPrContent = execSync(`cat ${srcDir}/solve.auto-pr.lib.mjs`, { encoding: 'utf8' });
const readinessContent = execSync(`cat ${srcDir}/solve.auto-pr-compare-readiness.lib.mjs`, { encoding: 'utf8' });

test('auto-pr lib imports and delegates to handleCompareApiNotReady', () => {
  if (!/import\s*\{[^}]*handleCompareApiNotReady[^}]*\}\s*from\s*'\.\/solve\.auto-pr-compare-readiness\.lib\.mjs'/.test(autoPrContent)) {
    throw new Error('solve.auto-pr.lib.mjs does not import handleCompareApiNotReady');
  }
  if (!autoPrContent.includes('compareReady = await handleCompareApiNotReady(')) {
    throw new Error('solve.auto-pr.lib.mjs does not delegate the not-ready decision to handleCompareApiNotReady');
  }
});

test('readiness handler imports isTransientCompareApiError from github-rate-limit.lib.mjs', () => {
  if (!/import\s*\{[^}]*isTransientCompareApiError[^}]*\}\s*from\s*'\.\/github-rate-limit\.lib\.mjs'/.test(readinessContent)) {
    throw new Error('isTransientCompareApiError is not imported from github-rate-limit.lib.mjs');
  }
});

test('computes the last compare output as a STRING (Buffer-safe)', () => {
  // Guards against the Buffer regression: detectors call toLowerCase() on it.
  if (!readinessContent.includes('compareResult?.stdout?.toString?.()')) {
    throw new Error('lastCompareOutput is not built from stringified stdout/stderr');
  }
});

test('has a degraded-mode branch that returns true on transient failure', () => {
  if (!readinessContent.includes('compareFailedTransiently')) {
    throw new Error('No compareFailedTransiently branch found');
  }
  if (!readinessContent.includes('COMPARE API DEGRADED')) {
    throw new Error('No "COMPARE API DEGRADED" user-facing message found');
  }
  // The degraded branch must NOT throw; it must proceed by returning true.
  const degradedIdx = readinessContent.indexOf('} else if (compareFailedTransiently) {');
  if (degradedIdx === -1) {
    throw new Error('Degraded-mode else-if branch not found');
  }
  const finalElseIdx = readinessContent.indexOf('// Original timeout error for other cases', degradedIdx);
  if (finalElseIdx === -1) {
    throw new Error('Final hard-error else branch not found after degraded branch');
  }
  const degradedBlock = readinessContent.slice(degradedIdx, finalElseIdx);
  if (!degradedBlock.includes('return true')) {
    throw new Error('Degraded branch does not return true (proceed to PR creation)');
  }
  if (degradedBlock.includes('throw new Error')) {
    throw new Error('Degraded branch must not throw — it should proceed to PR creation');
  }
});

test('still throws the original error for non-transient timeouts', () => {
  // The hard-error path (0 commits / unknown failure) must remain.
  if (!readinessContent.includes("throw new Error('GitHub compare API not ready - cannot create PR safely')")) {
    throw new Error('The original hard-error path was removed');
  }
});

test('fork 404 mismatch path is preserved (must stay fatal)', () => {
  if (!readinessContent.includes("throw new Error('Repository is not a GitHub fork - cannot create PR to unrelated repository')")) {
    throw new Error('Fork-not-a-fork error path was removed');
  }
});

test('degraded-mode decision excludes the fork 404 mismatch', () => {
  // compareFailedTransiently must be guarded by !isRepositoryMismatch so a
  // 404 fork mismatch never silently degrades.
  if (!readinessContent.includes('!isRepositoryMismatch && isTransientCompareApiError(lastCompareOutput)')) {
    throw new Error('compareFailedTransiently is not guarded by !isRepositoryMismatch');
  }
});

test('references issue #1829 for traceability', () => {
  if (!readinessContent.includes('#1829') && !readinessContent.includes('issue #1829')) {
    throw new Error('No issue #1829 reference found in the compare-readiness handler');
  }
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------

console.log(`\n📊 ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
