#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2296 (part C): the auto-restart-until-mergeable loop stopped on
 * `tool_failure` (a 401), solve still exited 0, and start-command removed the
 * container together with four uncommitted files. A tool failure must preserve
 * the uncommitted work (WIP commit + push) and make the process exit 1, which is
 * what keeps the container (`keepContainerOnFail`).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describePreservedWork, failOnToolFailure, getToolFailureExit, hasToolFailureExit, hasUnsavedWork, inspectUnsavedWork, resetToolFailureExit } from '../src/tool-failure-exit.lib.mjs';
import { finalizeSolveProcess } from '../src/solve.finalize.lib.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

const logs = [];
const log = async message => logs.push(String(message));

const runFinalize = async ({ tempDir = '/tmp/none', $ = null, limitReached = false, cleaned = [] } = {}) => {
  const exits = [];
  await finalizeSolveProcess({
    tempDir,
    $,
    argv: {},
    limitReached,
    path,
    getLogFile: () => null,
    log,
    closeSentry: async () => {},
    logActiveHandles: async () => {},
    cleanupTempDirectory: async dir => cleaned.push(dir),
    safeExit: async (code, reason) => exits.push({ code, reason }),
  });
  return exits;
};

console.log('\n=== Without a tool failure the run still exits 0 ===');
resetToolFailureExit();
assertEqual(hasToolFailureExit(), false, 'no failure recorded initially');
assertEqual(await runFinalize(), [{ code: 0, reason: 'Process completed' }], 'finalize exits 0');

console.log('\n=== A tool failure commits + pushes the work and records the failure ===');
const commitCalls = [];
const commit = async params => {
  commitCalls.push(params);
  return { committed: true, pushed: true };
};
const recorded = await failOnToolFailure({ tempDir: '/work', branchName: 'issue-1', $: () => {}, log, reason: 'tool_failure', subsystem: 'auto-restart-until-mergeable', commit });
assertEqual(commitCalls.length, 1, 'commit helper called once');
assertEqual({ tempDir: commitCalls[0].tempDir, branchName: commitCalls[0].branchName, push: commitCalls[0].push }, { tempDir: '/work', branchName: 'issue-1', push: true }, 'commit targets the work tree and pushes to the branch');
assertEqual(commitCalls[0].reason, 'auto-restart-until-mergeable stopped: AI tool failed (tool_failure)', 'WIP commit message names the loop and the reason');
assertEqual(recorded, { reason: 'tool_failure', subsystem: 'auto-restart-until-mergeable', committed: true, pushed: true }, 'failure recorded with preservation result');
assertEqual(hasToolFailureExit(), true, 'failure visible to finalizeSolveProcess');
assertEqual(getToolFailureExit(), recorded, 'getToolFailureExit returns the record');

console.log('\n=== finalizeSolveProcess exits 1 after a tool failure ===');
logs.length = 0;
assertEqual(await runFinalize(), [{ code: 1, reason: 'AI tool execution failed' }], 'finalize exits 1 (container is kept)');
assertEqual(
  logs.some(line => line.includes('The AI tool failed (tool_failure)')),
  true,
  'finalize explains why it exits 1'
);
assertEqual(
  logs.some(line => line.includes('WIP commit and pushed')),
  true,
  'finalize reports the pushed WIP commit'
);

console.log('\n=== A throwing commit helper still records the failure ===');
resetToolFailureExit();
const throwing = await failOnToolFailure({
  tempDir: '/work',
  branchName: 'issue-1',
  $: () => {},
  log,
  reason: 'tool_failure',
  commit: async () => {
    throw new Error('git broke');
  },
});
assertEqual(throwing, { reason: 'tool_failure', subsystem: 'solve', committed: false, pushed: false }, 'failure recorded without preserved work');
assertEqual(hasToolFailureExit(), true, 'still exits 1');
resetToolFailureExit();

console.log('\n=== Comment line about the preserved work ===');
assertEqual(describePreservedWork({ committed: false, pushed: false }).includes('No uncommitted changes'), true, 'nothing to preserve');
assertEqual(describePreservedWork({ committed: true, pushed: true }).includes('pushed to the pull request branch'), true, 'pushed WIP commit');
assertEqual(describePreservedWork({ committed: true, pushed: false }).includes('push failed'), true, 'local-only WIP commit');

console.log('\n=== Every loop that stops on a tool failure records it ===');
const read = file => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const autoMerge = read('solve.auto-merge.lib.mjs');
const watch = read('solve.watch.lib.mjs');
const errorHandlers = read('solve.error-handlers.lib.mjs');
assertEqual((autoMerge.match(/await failOnToolFailure\(/g) || []).length, 2, 'auto-restart-until-mergeable: both tool_failure stops');
assertEqual((watch.match(/await failOnToolFailure\(/g) || []).length, 1, 'watch: the API-error stop');
const authBranch = errorHandlers.slice(errorHandlers.indexOf('if (error.isAuthError)'), errorHandlers.indexOf("safeExit(1, 'Authentication error')"));
assertEqual(authBranch.includes('commitUncommittedChangesOnCriticalError'), true, 'auth error exit commits uncommitted work first');

console.log('\n=== Unsaved work in the workspace keeps it (and the container) ===');
// Minimal command-stream stand-in: $({ cwd })`cmd` runs `cmd` through sh.
const $ =
  ({ cwd }) =>
  strings => {
    const result = spawnSync('sh', ['-c', strings.join('')], { cwd, encoding: 'utf8' });
    return Promise.resolve({ code: result.status, stdout: result.stdout, stderr: result.stderr });
  };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2296-'));
const remote = path.join(root, 'remote.git');
const work = path.join(root, 'work');
git(root, 'init', '-q', '--bare', remote);
git(root, 'clone', '-q', remote, work);
git(work, 'config', 'user.email', 'test@example.com');
git(work, 'config', 'user.name', 'test');
fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
git(work, 'add', '-A');
git(work, 'commit', '-q', '-m', 'init');
git(work, 'push', '-q', 'origin', 'HEAD');

assertEqual(await inspectUnsavedWork({ tempDir: work, $ }), { uncommitted: [], unpushedCommits: 0 }, 'clean, pushed workspace');
let cleaned = [];
assertEqual(await runFinalize({ tempDir: work, $, cleaned }), [{ code: 0, reason: 'Process completed' }], 'clean workspace: exit 0');
assertEqual(cleaned, [work], 'clean workspace: cleanup runs');

fs.writeFileSync(path.join(work, 'a.txt'), 'changed\n');
fs.writeFileSync(path.join(work, 'new.mjs'), 'x\n');
const dirty = await inspectUnsavedWork({ tempDir: work, $ });
assertEqual(dirty, { uncommitted: [' M a.txt', '?? new.mjs'], unpushedCommits: 0 }, 'uncommitted changes are found');
assertEqual(hasUnsavedWork(dirty), true, 'uncommitted changes are unsaved work');
cleaned = [];
assertEqual(await runFinalize({ tempDir: work, $, cleaned }), [{ code: 1, reason: 'Unsaved work in the workspace' }], 'uncommitted changes: exit 1');
assertEqual(cleaned, [], 'uncommitted changes: the workspace is not deleted');

git(work, 'add', '-A');
git(work, 'commit', '-q', '-m', 'local only');
const unpushed = await inspectUnsavedWork({ tempDir: work, $ });
assertEqual(unpushed, { uncommitted: [], unpushedCommits: 1 }, 'an unpushed commit is found');
assertEqual(await runFinalize({ tempDir: work, $ }), [{ code: 1, reason: 'Unsaved work in the workspace' }], 'unpushed commit: exit 1');
assertEqual(await runFinalize({ tempDir: work, $, limitReached: true }), [{ code: 0, reason: 'Process completed' }], 'limit reached: the workspace is kept for resume anyway');

git(work, 'push', '-q', 'origin', 'HEAD');
assertEqual(hasUnsavedWork(await inspectUnsavedWork({ tempDir: work, $ })), false, 'after push nothing is unsaved');
assertEqual(await inspectUnsavedWork({ tempDir: path.join(root, 'missing'), $ }), null, 'missing workspace: unknown, not unsaved');
assertEqual(await inspectUnsavedWork({ tempDir: work, $: null }), null, 'no executor: unknown');
fs.rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
