#!/usr/bin/env node

/**
 * Regression coverage for issue #2263 and PR feedback.
 *
 * The Kotlin canary ended with a failed `javac` tool result after rewriting
 * Main.java and creating Main.class. Recovery auto-committed the working tree,
 * and a later no-CI path treated the clean tree as successful and marked the PR
 * ready before reporting the terminal failure.
 *
 * Recovery commits remain intentional: repositories decide which generated
 * files to ignore through `.gitignore`. The correctness boundary is that a
 * failed verification remains failure, keeps the PR draft, and vetoes every
 * later ready/merge path even after recovery makes the worktree clean.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { exec as execCallback } from 'node:child_process';
import fsModule from 'node:fs';
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
const configureRepository = async directory => {
  await run(directory, 'git init -q');
  await run(directory, 'git config user.name "Hive Mind Test"');
  await run(directory, 'git config user.email "hive-mind-test@example.invalid"');
};
const silentLog = async () => {};

// The captured Formal AI stream ended with compiler diagnostics, but the
// following top-level provider event reported success.
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

// A later successful tool result really supersedes an exploratory failure.
terminalToolResult = updateTerminalToolResult(terminalToolResult, collectClaudeStreamEventFacts({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'javac-2', content: 'ok' }] } }));
assert.equal(terminalToolResult.failed, false);

// Replay the reported ordering through the real command wrapper: failed javac
// result, then a provider-level success envelope. The wrapper must return a
// failed session and retain the compiler diagnostic.
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';
globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fsModule, default: fsModule };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const streamEvents = [
  {
    type: 'user',
    session_id: 'issue-2263-session',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'javac-2263',
          is_error: true,
          content: 'Exit code 1\nMain.java:3: error: not a statement',
        },
      ],
    },
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Implementation complete.',
    total_cost_usd: 0,
    num_turns: 1,
  },
];
const streamDollar = () => () => ({
  pid: 2263,
  result: { code: 0 },
  kill: () => {},
  async *stream() {
    yield { type: 'stdout', data: Buffer.from(`${streamEvents.map(event => JSON.stringify(event)).join('\n')}\n`) };
  },
});
const streamFixture = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2263-stream-'));
try {
  const initialLogFile = path.join(streamFixture, 'current.log');
  await writeFile(initialLogFile, '');
  let logFile = initialLogFile;
  const result = await executeClaudeCommand({
    tempDir: streamFixture,
    branchName: 'issue-2263',
    prompt: 'Solve and verify.',
    systemPrompt: 'Solve the issue.',
    escapedPrompt: 'Solve and verify.',
    escapedSystemPrompt: 'Solve the issue.',
    argv: { model: 'formal-ai', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/2263', verbose: false, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false },
    log: silentLog,
    setLogFile: nextLogFile => {
      logFile = nextLogFile;
    },
    getLogFile: () => logFile,
    formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
    getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    claudePath: 'claude',
    $: streamDollar,
    owner: 'link-assistant',
    repo: 'hive-mind',
    prNumber: 2271,
    issueNumber: 2263,
  });
  assert.equal(result.success, false, 'the provider success envelope cannot override failed terminal verification');
  assert.equal(result.errorDuringExecution, true);
  assert.match(result.errorInfo.message, /Main\.java:3: error: not a statement/, 'the failure result retains the verification diagnostic');
} finally {
  await rm(streamFixture, { recursive: true, force: true });
}

// Recovery continues to commit and push dirty work, but Git—not Hive Mind—owns
// the artifact policy. A repository-provided .gitignore excludes Main.class.
const fixture = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2263-worktree-'));
const remoteFixture = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2263-remote-'));
try {
  await configureRepository(fixture);
  await run(remoteFixture, 'git init --bare -q');
  await writeFile(path.join(fixture, '.gitignore'), '*.class\n');
  await writeFile(path.join(fixture, 'Main.java'), 'class Main { public static void main(String[] args) { System.out.println("ok"); } }\n');
  await run(fixture, 'git add .gitignore Main.java && git commit -qm "valid source"');
  await run(fixture, `git remote add origin ${quote(remoteFixture)}`);
  await run(fixture, 'git branch -M issue-2263 && git push -qu origin issue-2263');
  const originalHead = await run(fixture, 'git rev-parse HEAD');

  await writeFile(path.join(fixture, 'Main.java'), 'class Main { public static void main(String[] args) { this is invalid } }\n');
  await writeFile(path.join(fixture, 'Main.class'), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));

  const verification = await command({ cwd: fixture })`${process.execPath} -e ${"process.stderr.write('Main.java:3: error: not a statement\\n'); process.exit(1)"}`;
  assert.equal(verification.code, 1, 'the integration fixture ends in a non-zero verification command');
  const observedVerification = updateTerminalToolResult(
    null,
    collectClaudeStreamEventFacts({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'fixture-verification', is_error: true, content: `Exit code ${verification.code}\n${verification.stderr}` }] },
    })
  );
  assert.equal(observedVerification.failed, true);
  assert.equal(observedVerification.benign, false);
  assert.match(observedVerification.error, /Main\.java:3/, 'the terminal diagnostic survives classification');

  const preserved = await commitUncommittedChangesOnCriticalError({
    tempDir: fixture,
    branchName: 'issue-2263',
    $: command,
    log: silentLog,
    reason: 'javac verification failed',
  });

  assert.deepEqual(preserved, { committed: true, pushed: true }, 'recovery auto-commits and pushes the failed partial work');
  const recoveryHead = await run(fixture, 'git rev-parse HEAD');
  assert.notEqual(recoveryHead, originalHead, 'the recovery commit advances the local branch');
  assert.equal(await run(fixture, `git --git-dir=${quote(remoteFixture)} rev-parse refs/heads/issue-2263`), recoveryHead, 'the recovery commit reaches the remote PR branch');
  assert.match(await run(fixture, 'git log -1 --format=%s'), /Auto-commit before critical-error recovery/, 'branch history labels the commit as recovery evidence');
  assert.match(await run(fixture, 'git show HEAD:Main.java'), /this is invalid/, 'the failed source is retained for the next session to repair');
  assert.doesNotMatch(await run(fixture, 'git ls-tree -r --name-only HEAD'), /Main\.class/, 'the repository .gitignore keeps compiler output out of the commit');
  assert.equal(await run(fixture, 'git status --porcelain --untracked-files=all'), '', 'recovery leaves a clean worktree even though the session failed');
} finally {
  await rm(fixture, { recursive: true, force: true });
  await rm(remoteFixture, { recursive: true, force: true });
}

// Without a repository ignore rule, untracked files remain ordinary recovery
// input. Hive Mind must not guess that a file extension is disposable.
const unignoredFixture = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2263-unignored-'));
try {
  await configureRepository(unignoredFixture);
  await writeFile(path.join(unignoredFixture, 'README.md'), 'fixture\n');
  await run(unignoredFixture, 'git add README.md && git commit -qm "baseline"');
  await writeFile(path.join(unignoredFixture, 'Main.class'), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  const preserved = await commitUncommittedChangesOnCriticalError({ tempDir: unignoredFixture, $: command, log: silentLog, reason: 'unignored artifact fixture', push: false });
  assert.deepEqual(preserved, { committed: true, pushed: false });
  assert.match(await run(unignoredFixture, 'git ls-tree -r --name-only HEAD'), /^Main\.class$/m, 'without .gitignore the untracked artifact is preserved in the recovery commit');
} finally {
  await rm(unignoredFixture, { recursive: true, force: true });
}

// A failure is a monotonic veto for the rest of this run. This reproduces a
// clean worktree after recovery followed by the no-CI readiness path.
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

// Keep orchestration ordering under test: record failure first, preserve work
// second, and publish terminal diagnostics last.
const repoRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const solveSource = await readFile(path.join(repoRoot, 'src', 'solve.mjs'), 'utf8');
const failureBranch = solveSource.slice(solveSource.indexOf('if ((!success || errorDuringExecution)'), solveSource.indexOf('// Clean up .playwright-mcp/'));
assert.ok(failureBranch.indexOf('ensurePullRequestStaysDraftAfterFailure') < failureBranch.indexOf('commitUncommittedChangesOnCriticalError'), 'failure veto is recorded before recovery auto-commit');
const progressSource = await readFile(path.join(repoRoot, 'src', 'session-progress.lib.mjs'), 'utf8');
const progressFailureBranch = progressSource.slice(progressSource.indexOf('export const failOnNoProgressBetweenSessions'));
assert.ok(progressFailureBranch.indexOf('ensurePullRequestStaysDraftAfterFailure') < progressFailureBranch.indexOf('reportNoProgressStop({'), 'no-progress restores draft before posting its terminal comment');
const autoMergeSource = await readFile(path.join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
assert.match(autoMergeSource, /readinessVeto\?\.kind === 'failure'/, 'the monitor refuses to publish readiness after terminal failure');
const autoMergeAttemptSource = await readFile(path.join(repoRoot, 'src', 'solve.auto-merge-attempt.lib.mjs'), 'utf8');
assert.match(autoMergeAttemptSource, /readinessVeto\?\.kind === 'failure'/, 'one-shot auto-merge refuses to override terminal failure');

console.log('PASS: issue #2263 failed recovery remains draft and obeys repository ignore policy');
process.exit(0);
