#!/usr/bin/env node
/**
 * Issue #1722: /merge command failed to wait for CI/CD on default branch
 *
 * Regression tests for the silent-failure path in getActiveBranchRuns():
 * before the fix, a `stdout maxBuffer length exceeded` error was caught and
 * converted into `hasActiveRuns: false`, causing /merge to merge on top of a
 * still-running CI run.
 *
 * The fix:
 *   1. Query each active status separately so we never download the full
 *      historical run list (server-side filter via ?status=).
 *   2. Raise exec's maxBuffer to githubLimits.bufferMaxSize.
 *   3. Stop swallowing fetch errors as "no active runs" — let them bubble so
 *      the wait loop in waitForBranchCI retries on the next poll.
 *
 * Strategy: the modules under test invoke `gh` via child_process.exec. We can't
 * cleanly intercept the named exec import from outside, so instead we shadow
 * the `gh` binary by prepending a directory with a fake `gh` script to PATH.
 * The fake `gh` reads scripted responses from an env-var-pointed file.
 *
 * Run with: node tests/test-active-branch-runs-buffer-1722.mjs
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1722
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set up a fake `gh` on PATH BEFORE importing modules under test.
const tmp = mkdtempSync(join(tmpdir(), 'hive-1722-'));
const binDir = join(tmp, 'bin');
mkdirSync(binDir);
const stateFile = join(tmp, 'state.json');
const callsFile = join(tmp, 'calls.log');

const ghScript = `#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2).join(' ');
appendFileSync(${JSON.stringify(callsFile)}, args + '\\n');
let state;
try { state = JSON.parse(readFileSync(${JSON.stringify(stateFile)}, 'utf8')); } catch { state = { mode: 'idle' }; }

function emit(s) {
  // Use a callback to ensure the kernel buffer drains before we exit.
  // Without this, large writes can get truncated if the parent reads slowly.
  return new Promise(resolve => {
    if (!process.stdout.write(s)) {
      process.stdout.once('drain', resolve);
    } else {
      resolve();
    }
  });
}

if (state.mode === 'maxbuffer') {
  // Simulate GitHub's per-status response with a >1 MB payload of in_progress
  // runs. Without the fix's raised maxBuffer, exec would reject with
  // "stdout maxBuffer length exceeded". With the fix, the function handles
  // a 2 MB response cleanly. Other status queries return empty.
  if (args.includes('status=in_progress')) {
    await emit(JSON.stringify([{ workflow_runs: Array.from({ length: 4000 }, (_, i) => ({ id: i, name: 'CI', status: 'in_progress', created_at: 't', html_url: 'u' })) }]));
  } else {
    await emit('[]');
  }
  process.exit(0);
}
if (state.mode === 'fail') {
  process.stderr.write('boom\\n');
  process.exit(1);
}
if (state.mode === 'idle') {
  process.stdout.write('[]');
  process.exit(0);
}
if (state.mode === 'in-progress') {
  if (args.includes('status=in_progress')) {
    process.stdout.write(JSON.stringify([{ workflow_runs: [{ id: 1, name: 'CI', status: 'in_progress', created_at: 't', html_url: 'u' }] }]));
  } else {
    process.stdout.write('[]');
  }
  process.exit(0);
}
if (state.mode === 'duplicates') {
  if (args.includes('status=in_progress') || args.includes('status=queued')) {
    process.stdout.write(JSON.stringify([{ workflow_runs: [{ id: 42, name: 'CI', status: 'in_progress' }] }]));
  } else {
    process.stdout.write('[]');
  }
  process.exit(0);
}
process.stdout.write('[]');
process.exit(0);
`;

const ghPath = join(binDir, 'gh');
writeFileSync(ghPath, ghScript);
chmodSync(ghPath, 0o755);

process.env.PATH = `${binDir}:${process.env.PATH}`;

const { readFileSync } = await import('node:fs');

function setMode(mode) {
  writeFileSync(stateFile, JSON.stringify({ mode }));
  // Truncate call log
  writeFileSync(callsFile, '');
}

function readCalls() {
  try {
    return readFileSync(callsFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const { getActiveBranchRuns, waitForBranchCI } = await import('../src/github-merge.lib.mjs');
const { getAllActiveRepoRuns } = await import('../src/github-merge-repo-actions.lib.mjs');

let testsPassed = 0;
let testsFailed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.stack || error.message}`);
    testsFailed++;
  }
}

console.log('\n📋 Issue #1722: /merge active branch CI detection\n');

await asyncTest('getActiveBranchRuns queries each active status (not the full history)', async () => {
  setMode('in-progress');
  const result = await getActiveBranchRuns('o', 'r', 'main', false);
  assert.equal(result.hasActiveRuns, true);
  assert.equal(result.count, 1);
  assert.equal(result.runs[0].id, 1);

  const calls = readCalls();
  assert.ok(calls.length > 0, 'gh must have been called');
  assert.ok(
    calls.every(c => c.includes('status=')),
    `every call must include status= filter — got: ${calls.join(' | ')}`
  );
  assert.ok(
    calls.some(c => c.includes('status=in_progress')),
    'must query status=in_progress'
  );
  assert.ok(
    calls.some(c => c.includes('status=queued')),
    'must query status=queued'
  );
});

await asyncTest('getActiveBranchRuns deduplicates runs that appear under multiple statuses', async () => {
  setMode('duplicates');
  const result = await getActiveBranchRuns('o', 'r', 'main', false);
  assert.equal(result.count, 1, `expected dedup to 1, got ${result.count}`);
  assert.equal(result.runs[0].id, 42);
});

await asyncTest('getActiveBranchRuns survives a >1 MB response (bug #1722 buffer fix)', async () => {
  setMode('maxbuffer');
  // Pre-fix: this would throw "stdout maxBuffer length exceeded" and the
  // function would silently return hasActiveRuns: false. The fix raises the
  // exec maxBuffer to githubLimits.bufferMaxSize (default 10 MB), so a 2 MB
  // response is handled cleanly.
  const result = await getActiveBranchRuns('o', 'r', 'main', false);
  assert.equal(result.hasActiveRuns, true);
  assert.equal(result.count, 4000);
});

await asyncTest('getActiveBranchRuns throws on gh failure (does NOT silently report idle)', async () => {
  setMode('fail');
  await assert.rejects(() => getActiveBranchRuns('o', 'r', 'main', false), /Command failed|boom/i, 'must propagate gh errors');
});

await asyncTest('waitForBranchCI keeps polling on fetch errors (does NOT report ready)', async () => {
  setMode('fail');
  const result = await waitForBranchCI('o', 'r', 'main', { timeout: 200, pollInterval: 50 }, false);
  assert.equal(result.success, false, 'must NOT return success when every fetch errors');
  assert.match(result.error || '', /Timeout|failed/i);
});

await asyncTest('waitForBranchCI returns success when CI is genuinely idle', async () => {
  setMode('idle');
  const result = await waitForBranchCI('o', 'r', 'main', { timeout: 5000, pollInterval: 10 }, false);
  assert.equal(result.success, true);
  assert.equal(result.waitedForRuns, false);
  assert.equal(result.completedRuns, 0);
});

await asyncTest('getAllActiveRepoRuns also uses status filters', async () => {
  setMode('idle');
  const result = await getAllActiveRepoRuns('o', 'r', false);
  assert.equal(result.hasActiveRuns, false);
  const calls = readCalls();
  assert.ok(calls.length > 0, 'gh must have been called');
  assert.ok(
    calls.every(c => c.includes('status=')),
    `every repo-actions call must include status= filter — got: ${calls.join(' | ')}`
  );
});

await asyncTest('getAllActiveRepoRuns propagates gh errors', async () => {
  setMode('fail');
  await assert.rejects(() => getAllActiveRepoRuns('o', 'r', false), /Command failed|boom/i, 'getAllActiveRepoRuns must propagate exec errors');
});

// Cleanup
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {}

console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed > 0 ? 1 : 0);
