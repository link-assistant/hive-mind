#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2048: The --development-log commit must be pushed BEFORE any pull
 * request readiness is signalled (working-session summary, verifyResults log
 * attachment, and the auto-restart-until-mergeable "Ready to merge" comment).
 *
 * In PR #2046 the development-log commit landed one second AFTER the
 * "✅ Ready to merge" comment, which broke the "Check for Changesets" CI job
 * without any readiness re-evaluation. See docs/case-studies/issue-2048.
 *
 * This is a source-ordering regression guard: it asserts that in solve.mjs the
 * development-log finalization runs before the readiness-signalling steps.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const solveSource = await readFile(join(here, '..', 'src', 'solve.mjs'), 'utf8');

// The success-path finalize call must exist and be attributed to this issue.
const finalizeIndex = solveSource.indexOf('await finalizeDevelopmentLog();');
assert.ok(finalizeIndex > -1, 'solve.mjs must finalize the development log on the success path');

// Readiness-signalling anchors that must come AFTER the early finalize.
const readinessAnchors = ['await maybeAttachWorkingSessionSummary(', 'const verifyResult = await verifyResults(', 'await startAutoRestartUntilMergeable('];

for (const anchor of readinessAnchors) {
  const anchorIndex = solveSource.indexOf(anchor);
  assert.ok(anchorIndex > -1, `solve.mjs must contain readiness anchor: ${anchor}`);
  assert.ok(finalizeIndex < anchorIndex, `development log must be finalized before "${anchor}" (issue #2048): finalize at ${finalizeIndex}, anchor at ${anchorIndex}`);
}

// The issue reference must be present so the ordering intent is documented in code.
assert.ok(/issue #2048/i.test(solveSource), 'solve.mjs should reference issue #2048 for the readiness-ordering fix');

console.log('development-log-before-readiness (issue #2048) ordering tests passed');
