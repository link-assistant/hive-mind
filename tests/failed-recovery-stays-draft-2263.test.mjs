#!/usr/bin/env node

/**
 * Regression coverage for issue #2263.
 *
 * The Kotlin canary ended with a failed `javac` tool result after rewriting
 * Main.java and creating Main.class. Critical-error recovery committed both to
 * the pull-request branch, and the later no-CI path marked that failed solution
 * ready before the terminal failure comment was posted.
 *
 * This fixture keeps the four boundaries together: Claude's last tool result,
 * recovery storage, generated-output exclusion, and the monotonic PR draft
 * decision.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { exec as execCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { collectClaudeStreamEventFacts, updateTerminalToolResult } from '../src/claude.stream-events.lib.mjs';
import { commitUncommittedChangesOnCriticalError } from '../src/critical-error-commit.lib.mjs';
import { ensurePullRequestIsReady, ensurePullRequestStaysDraftAfterFailure, getPullRequestLeftInDraft, resetWorkingSessionDrafts } from '../src/pr-draft-state.lib.mjs';

const exec = promisify(execCallback);
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const command =
  options =>
  async (strings, ...values) => {
    const source = strings.reduce((result, part, index) => result + part + (index < values.length ? quote(values[index]) : ''), '');
    try {
      const result = await exec(source, { cwd: options?.cwd });
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      return { code: error.code || 1, stdout: error.stdout || '', stderr: error.stderr || error.message };
    }
  };

const run = async (cwd, source) => (await exec(source, { cwd })).stdout.trim();
const silentLog = async () => {};

// The final tool result in the captured Formal AI stream was detailed enough
// to be non-benign, but the following top-level result event said "success".
const failedVerification = collectClaudeStreamEventFacts({
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'javac-1',
        is_error: true,
        content: 'Exit code 1\nMain.java:3: error: not a statement',
      },
    ],
  },
});
assert.equal(failedVerification.toolResultObserved, true);
assert.equal(failedVerification.toolResultFailed, true);
let terminalToolResult = updateTerminalToolResult(null, failedVerification);
assert.equal(terminalToolResult.failed, true, 'a terminal failed verification must override the provider success envelope');
assert.equal(terminalToolResult.benign, false, 'compiler diagnostics are not a self-handled bare exit status');
assert.match(terminalToolResult.error, /Main\.java:3/);

const selfHandledProbe = updateTerminalToolResult(null, collectClaudeStreamEventFacts({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'probe-1', is_error: true, content: 'Exit code 1' }] } }));
assert.equal(selfHandledProbe.benign, true, 'existing self-handled bare-exit semantics remain intact');

// A later successful tool result really does supersede an earlier exploratory
// failure; only the terminal tool state controls readiness.
terminalToolResult = updateTerminalToolResult(terminalToolResult, collectClaudeStreamEventFacts({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'javac-2', content: 'ok' }] } }));
assert.equal(terminalToolResult.failed, false);

const fixture = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2263-'));
try {
  await run(fixture, 'git init -q');
  await run(fixture, 'git config user.name "Hive Mind Test"');
  await run(fixture, 'git config user.email "hive-mind-test@example.invalid"');
  await writeFile(path.join(fixture, 'Main.java'), 'class Main { public static void main(String[] args) { System.out.println("ok"); } }\n');
  await run(fixture, 'git add Main.java && git commit -qm "valid source"');
  const originalHead = await run(fixture, 'git rev-parse HEAD');

  await writeFile(path.join(fixture, 'Main.java'), 'class Main { public static void main(String[] args) { this is invalid } }\n');
  await writeFile(path.join(fixture, 'Main.class'), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));

  const preserved = await commitUncommittedChangesOnCriticalError({
    tempDir: fixture,
    branchName: 'issue-2263',
    $: command,
    log: silentLog,
    reason: 'javac verification failed',
  });

  assert.equal(preserved.preserved, true, 'recovery retains the dirty source as diagnostic evidence');
  assert.ok(preserved.recoveryRef, 'recovery returns a durable local reference to the evidence');
  assert.equal(preserved.committed, false, 'failed bytes are not promoted to a solution commit');
  assert.equal(preserved.pushed, false, 'failed bytes are not pushed to the pull-request branch');
  assert.equal(await run(fixture, 'git rev-parse HEAD'), originalHead, 'the PR branch head is unchanged');
  assert.equal(await run(fixture, 'git log --format=%s'), 'valid source', 'no recovery commit appears in branch history');
  assert.match(await readFile(path.join(fixture, 'Main.java'), 'utf8'), /this is invalid/, 'the working copy remains available for diagnosis or repair');
  assert.match(await run(fixture, `git show ${quote(preserved.recoveryRef)}:Main.java`), /this is invalid/, 'the recovery reference retains the invalid source independently of the worktree');

  const exclude = await readFile(path.join(fixture, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /^\*\.class$/m, 'compiled Java outputs are locally excluded from source commits');
  assert.doesNotMatch(await run(fixture, 'git status --porcelain --untracked-files=all'), /Main\.class/, 'Main.class is absent from source-change bookkeeping');
} finally {
  await rm(fixture, { recursive: true, force: true });
}

// A failure is a monotonic veto for the rest of this run. This reproduces the
// reported order: an earlier ready state, then failure, then later readiness
// safety nets which must not undo the failure.
const state = { isDraft: false };
const calls = [];
const fakeGitHub =
  () =>
  async (strings, ...values) => {
    const source = strings.reduce((result, part, index) => result + part + (index < values.length ? String(values[index]) : ''), '');
    calls.push(source);
    if (source.includes('gh pr view')) return { code: 0, stdout: JSON.stringify({ isDraft: state.isDraft, state: 'OPEN' }), stderr: '' };
    if (source.includes('gh pr ready')) {
      state.isDraft = source.includes('--undo');
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

resetWorkingSessionDrafts();
const $ = fakeGitHub();
const pr = { owner: 'konard', repo: 'kotlin-canary', prNumber: 2, $, log: silentLog };
await ensurePullRequestStaysDraftAfterFailure({ ...pr, reason: 'javac verification failed' });
assert.equal(state.isDraft, true, 'a later failure actively restores draft state');
assert.equal(getPullRequestLeftInDraft(pr).kind, 'failure');
const laterReady = await ensurePullRequestIsReady({ ...pr, reason: 'session end' });
assert.equal(laterReady.reason, 'left_in_draft_on_purpose');
assert.equal(state.isDraft, true, 'session-end and no-CI readiness paths cannot override failure');
assert.equal(calls.filter(call => call.includes('gh pr ready') && !call.includes('--undo')).length, 0, 'no ready conversion follows the failure');
resetWorkingSessionDrafts();

// Keep the orchestration ordering under test: draft failure first, preserve
// evidence second, publish the terminal diagnostic last.
const repoRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const solveSource = await readFile(path.join(repoRoot, 'src', 'solve.mjs'), 'utf8');
const failureBranch = solveSource.slice(solveSource.indexOf('if ((!success || errorDuringExecution)'), solveSource.indexOf('// Clean up .playwright-mcp/'));
assert.ok(failureBranch.indexOf('ensurePullRequestStaysDraftAfterFailure') < failureBranch.indexOf('commitUncommittedChangesOnCriticalError'), 'failure veto is recorded before recovery');
const progressSource = await readFile(path.join(repoRoot, 'src', 'session-progress.lib.mjs'), 'utf8');
const progressFailureBranch = progressSource.slice(progressSource.indexOf('export const failOnNoProgressBetweenSessions'));
assert.ok(progressFailureBranch.indexOf('ensurePullRequestStaysDraftAfterFailure') < progressFailureBranch.indexOf('reportNoProgressStop({'), 'no-progress restores draft before posting its terminal comment');
const autoMergeSource = await readFile(path.join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
assert.match(autoMergeSource, /readinessVeto\?\.kind === 'failure'/, 'the monitor refuses to publish readiness after terminal failure');
const autoMergeAttemptSource = await readFile(path.join(repoRoot, 'src', 'solve.auto-merge-attempt.lib.mjs'), 'utf8');
assert.match(autoMergeAttemptSource, /readinessVeto\?\.kind === 'failure'/, 'one-shot auto-merge refuses to override terminal failure');
const finalizeSource = await readFile(path.join(repoRoot, 'src', 'solve.finalize.lib.mjs'), 'utf8');
assert.match(finalizeSource, /if \(recoveryFailure\?\.preserved\)/, 'the off-branch recovery reference is not deleted during terminal-failure cleanup');

console.log('PASS: issue #2263 failed recovery stays out of the PR branch and leaves the PR draft');
