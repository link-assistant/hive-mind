#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2119 - a single auto-restart system.
 *
 * Reproduction: https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2
 * posted both `🔄 Auto-restart triggered (iteration 1)` and `🔄 Auto-restart 1/5 Log`.
 * Those came from two independent subsystems, each with its own counter reading
 * the same `--auto-restart-max-iterations` flag, and `solve.mjs` runs both in
 * one process - so a limit of 5 permitted 10 AI sessions and the run still
 * exited successfully with the blocker unresolved.
 *
 * The issue requires: one auto-restart system, every label in `N/M` form, a hard
 * stop after the limit, and a real failure with auto-commit fail recovery so the
 * result stays visible.
 */

import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { beginAutoRestartBudget, consumeAutoRestartIteration, formatAutoRestartLabel, formatAutoRestartLimit, getAutoRestartIterationsUsed, getAutoRestartLimit, getRemainingAutoRestartIterations, hasExhaustedAutoRestartBudget, resetAutoRestartBudget } from '../src/auto-restart-budget.lib.mjs';
import { AUTO_RESTART_LIMIT_REACHED_REASON, failOnAutoRestartBudgetExhausted, getAutoRestartLimitFailure, hasAutoRestartLimitFailure, resetAutoRestartLimitFailure } from '../src/auto-restart-exhaustion.lib.mjs';
import { DEFAULT_AUTO_ITERATION_LIMIT } from '../src/auto-iteration-limits.lib.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const noopLog = async () => {};
const formatAligned = (icon, label, value) => `${icon} ${label} ${value}`;

/** A command-stream lookalike: records commands and reports a dirty tree. */
const makeFake$ = (statusOutput = '') => {
  const calls = [];
  const fake = () => async strings => {
    const cmd = strings.join(' ');
    calls.push(cmd);
    if (cmd.includes('git status')) return { code: 0, stdout: statusOutput, stderr: '' };
    if (cmd.includes('gh api')) return { code: 0, stdout: '{"id":1}', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  fake.calls = calls;
  return fake;
};

// --- the budget is shared, not per-subsystem --------------------------------
resetAutoRestartBudget();
assert.equal(getAutoRestartLimit(), DEFAULT_AUTO_ITERATION_LIMIT, 'the default limit is 5');

// The uncommitted-changes loop claims the budget first...
assert.equal(beginAutoRestartBudget({ maxIterations: 5 }), 5, 'the watch loop normalizes the limit');
assert.equal(consumeAutoRestartIteration(), 1, 'first AI session is iteration 1');
assert.equal(consumeAutoRestartIteration(), 2, 'second AI session is iteration 2');

// ...then the auto-restart-until-mergeable loop joins with the same flag value.
// Before the fix this restarted counting from 0, allowing 5 more sessions.
assert.equal(beginAutoRestartBudget({ maxIterations: 5 }), 5, 'the auto-merge loop joins the same budget');
assert.equal(getAutoRestartIterationsUsed(), 2, 'joining must not reset the iterations already spent');
assert.equal(getRemainingAutoRestartIterations(), 3, '3 of 5 iterations remain across both loops');
assert.equal(hasExhaustedAutoRestartBudget(), false, 'not exhausted at 2/5');

assert.equal(consumeAutoRestartIteration(), 3, 'the auto-merge loop continues the shared count');
assert.equal(consumeAutoRestartIteration(), 4);
assert.equal(consumeAutoRestartIteration(), 5, 'the 5th session across both loops');
assert.equal(hasExhaustedAutoRestartBudget(), true, 'stops after the 5th iteration, not the 10th');
assert.equal(getRemainingAutoRestartIterations(), 0, 'nothing left');

// --- every label uses the same N/M form -------------------------------------
assert.equal(formatAutoRestartLabel(1), '1/5', 'labels render as N/M');
assert.equal(formatAutoRestartLabel(), '5/5', 'the default label is the current iteration');
assert.equal(formatAutoRestartLimit(), '5', 'the limit renders as a plain number');

// --- 0 disables the limit ---------------------------------------------------
resetAutoRestartBudget();
assert.equal(beginAutoRestartBudget({ maxIterations: 0 }), 0, '0 means unlimited');
consumeAutoRestartIteration();
assert.equal(hasExhaustedAutoRestartBudget(), false, 'an unlimited budget is never exhausted');
assert.equal(getRemainingAutoRestartIterations(), null, 'no remaining count when unlimited');
assert.equal(formatAutoRestartLabel(), '1', 'an unlimited label has no denominator');
assert.equal(formatAutoRestartLimit(), 'unlimited', 'the unlimited limit is spelled out');

// --- exhaustion fails the run AND preserves the work ------------------------
resetAutoRestartBudget();
resetAutoRestartLimitFailure();
beginAutoRestartBudget({ maxIterations: 5, reset: true });
for (let i = 0; i < 5; i++) consumeAutoRestartIteration();

const dirty$ = makeFake$(' M examples/hello.scala\n?? .formal-ai/');
const failure = await failOnAutoRestartBudgetExhausted({
  owner: 'konard',
  repo: 'test-hello-world',
  prNumber: 2,
  tempDir: '/tmp/none',
  branchName: 'issue-1-abc',
  $: dirty$,
  log: noopLog,
  formatAligned,
  blocker: 'uncommitted changes remained',
  subsystem: 'auto-restart on uncommitted changes',
});

assert.equal(failure.reason, AUTO_RESTART_LIMIT_REACHED_REASON, 'the run reports the limit as its failure reason');
assert.equal(failure.iterationsUsed, 5, 'the failure reports the run-wide iteration count');
assert.equal(failure.committed, true, 'fail recovery auto-commits the uncommitted work');
assert.equal(failure.pushed, true, 'fail recovery pushes it so the result is visible');
assert.ok(
  dirty$.calls.some(c => c.includes('git commit')),
  'a real commit was made'
);
assert.ok(
  dirty$.calls.some(c => c.includes('git push')),
  'the preserved work was pushed'
);
assert.ok(
  dirty$.calls.some(c => c.includes('gh api')),
  'a limit-reached comment was posted to the PR'
);

assert.equal(hasAutoRestartLimitFailure(), true, 'the failure is visible to finalizeSolveProcess');
assert.equal(getAutoRestartLimitFailure().iterationsUsed, 5, 'the recorded failure carries the iteration count');

resetAutoRestartLimitFailure();
assert.equal(hasAutoRestartLimitFailure(), false, 'a fresh run starts without a recorded failure');

// A clean tree still fails, it just has nothing to preserve.
resetAutoRestartLimitFailure();
const clean$ = makeFake$('');
const cleanFailure = await failOnAutoRestartBudgetExhausted({ owner: 'o', repo: 'r', prNumber: null, tempDir: '/tmp/none', branchName: 'b', $: clean$, log: noopLog, formatAligned, blocker: 'CI still failing' });
assert.equal(cleanFailure.reason, AUTO_RESTART_LIMIT_REACHED_REASON, 'still a failure with a clean tree');
assert.equal(cleanFailure.committed, false, 'nothing to commit on a clean tree');
assert.ok(!clean$.calls.some(c => c.includes('gh api')), 'no comment is posted without a PR number');
resetAutoRestartLimitFailure();
resetAutoRestartBudget();

// --- the duplicated counters are gone ---------------------------------------
const watchSource = await readFile(path.join(srcDir, 'solve.watch.lib.mjs'), 'utf8');
const autoMergeSource = await readFile(path.join(srcDir, 'solve.auto-merge.lib.mjs'), 'utf8');
const finalizeSource = await readFile(path.join(srcDir, 'solve.finalize.lib.mjs'), 'utf8');

assert.ok(!/let\s+autoRestartCount\s*=\s*0/.test(watchSource), 'the watch loop no longer owns a private restart counter');
assert.ok(!/let\s+restartCount\s*=\s*0/.test(autoMergeSource), 'the auto-merge loop no longer owns a private restart counter');
assert.ok(watchSource.includes('consumeAutoRestartIteration()'), 'the watch loop claims iterations from the shared budget');
assert.ok(autoMergeSource.includes('consumeAutoRestartIteration()'), 'the auto-merge loop claims iterations from the shared budget');

// The divergent "(iteration N)" heading from the reproduction PR must be gone.
assert.ok(!autoMergeSource.includes('triggered (iteration ${restartCount})'), 'no more "Auto-restart triggered (iteration N)" heading');
assert.ok(!autoMergeSource.includes('Log (iteration ${restartCount})'), 'no more "(iteration N)" log title');
assert.ok(!/\$\{autoRestartCount\}\/\$\{maxAutoRestartIterations\}/.test(watchSource), 'labels are built by the shared formatter, not inlined');

// Both loops must route exhaustion through the one fail + auto-commit path.
assert.ok(watchSource.includes('failOnAutoRestartBudgetExhausted'), 'the watch loop fails on exhaustion');
assert.ok(autoMergeSource.includes('failOnAutoRestartBudgetExhausted'), 'the auto-merge loop fails on exhaustion');
assert.ok(finalizeSource.includes('safeExit(1'), 'the process exits non-zero when the limit was reached');

console.log('PASS: issue #2119 one auto-restart budget, N/M labels, hard stop with fail recovery');
