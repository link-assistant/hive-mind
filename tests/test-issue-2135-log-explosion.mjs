#!/usr/bin/env node

/**
 * Regression tests for issue #2135: "Work session failed (exit code: 1)" with a
 * 286 MB log.
 *
 * The captured session (docs/case-studies/issue-2135) ends like this:
 *
 *   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 *   ❌ Error: solve exited with code null
 *
 * and the log that recorded it had grown to 286 MB / 1,354,845 lines, seven
 * copies of the same pull request diff, each one bigger than the last:
 * `getPullRequestChangeStats` ran `gh pr diff` with command-stream's default
 * `mirror: true`, the stdio interceptor copied that answer into the session log,
 * `--development-log` committed the log to the branch, and the next run's
 * `gh pr diff` therefore contained the previous run's copy of itself.
 *
 * Five things had to change, and each is covered below:
 *   1. the diff is read quietly and measured in one pass, with a warning when
 *      it is large enough to be a symptom;
 *   2. every other unbounded-output probe is quiet too, so no single site can
 *      restart the loop;
 *   3. a child killed by a signal is reported as killed by that signal, not as
 *      "code null" (and, in hive, not as a success);
 *   4. the log says when it is running away, instead of growing silently from
 *      19 MB to 199 MB;
 *   5. a failed development-log publication discards the copies it wrote, so
 *      hive-mind's own artifacts are never read as the AI's uncommitted work -
 *      the restart trigger that multiplied the growth.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { attachChildExitHandlers, describeChildExit, isLikelyOutOfMemoryExit } from '../src/child-exit.lib.mjs';
import { collectAndCommitDevelopmentLogArtifacts, discardUnpublishedDevelopmentLog } from '../src/development-log.lib.mjs';
import { createLogGrowthTracker } from '../src/log-growth.lib.mjs';
import { getPullRequestChangeStats } from '../src/pull-request-changes.lib.mjs';
import { QUIET_PROBE } from '../src/quiet-probe.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- 1. the diff is read quietly ---------------------------------------------

// A `$` stand-in in command-stream's options-call shape: `$({...})` returns the
// tag, so the options the caller chose are observable.
const recording$ = ({ stdout = '' }) => {
  const calls = [];
  const tag = options => {
    calls.push(options);
    return () => Promise.resolve({ code: 0, stdout: Buffer.from(stdout) });
  };
  tag.calls = calls;
  return tag;
};

test('getPullRequestChangeStats reads the diff without mirroring it to stdout', async () => {
  const $ = recording$({ stdout: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+one\n' });
  const stats = await getPullRequestChangeStats({ owner: 'link-assistant', repo: 'hive-mind', prNumber: 2138, $ });

  assert.equal(stats.measured, true);
  assert.ok($.calls.length > 0, 'the diff command was configured rather than run with the defaults');
  for (const options of $.calls) {
    assert.equal(options.mirror, false, 'the diff is not echoed to stdout, where the log interceptor would copy it');
    assert.equal(options.capture, true, 'the diff is still captured, because the caller has to measure it');
  }
  assert.deepEqual(QUIET_PROBE, { mirror: false, capture: true }, 'the shared quiet-probe options are what the call sites apply');
});

test('a large diff is reported as the symptom it is', async () => {
  // 9 MB of added lines: past the warning threshold, and the size at which
  // measuring the diff starts to cost real memory.
  const line = `+${'x'.repeat(255)}\n`;
  const big = ['diff --git a/big.log b/big.log', '--- /dev/null', '+++ b/big.log', '@@ -0,0 +1,36000 @@'].join('\n') + '\n' + line.repeat(36000);
  const warnings = [];
  const stats = await getPullRequestChangeStats({
    owner: 'link-assistant',
    repo: 'hive-mind',
    prNumber: 2138,
    $: recording$({ stdout: big }),
    log: async (message, options) => warnings.push({ message, options }),
  });

  assert.equal(stats.measured, true);
  assert.equal(stats.filesChanged, 1);
  assert.equal(stats.additions, 36000, 'every added line is counted in the single pass');
  assert.ok(stats.diffBytes >= 8 * 1024 * 1024, 'the measured size is reported to the caller');
  const large = warnings.find(entry => entry.message.includes('MB'));
  assert.ok(large, 'a diff this size is called out');
  assert.equal(large.options.level, 'warning');
  assert.ok(large.message.includes('logs'), 'the warning names the usual cause: logs committed to the branch');
});

test('an ordinary diff produces no size warning', async () => {
  const warnings = [];
  await getPullRequestChangeStats({
    owner: 'link-assistant',
    repo: 'hive-mind',
    prNumber: 2138,
    $: recording$({ stdout: 'diff --git a/a.txt b/a.txt\n+++ b/a.txt\n+one\n' }),
    log: async message => warnings.push(message),
  });
  assert.deepEqual(warnings, [], 'a small diff is not worth a word');
});

// --- 2. no unbounded probe is left mirroring ---------------------------------

// Each entry is a call site the captured log showed dumping its whole answer
// into the session log. The check is deliberately source-level: a probe that
// regains `mirror: true` is exactly the regression this issue is about.
const QUIETED_PROBES = [
  ['src/pull-request-changes.lib.mjs', 'gh pr diff'],
  ['src/review.mjs', 'gh pr diff'],
  ['src/solve.keep-working.lib.mjs', '/files --paginate'],
  ['src/solve.preparation.lib.mjs', '/comments --paginate'],
  ['src/solve.results.lib.mjs', 'gh pr list'],
  ['src/solve.repository.lib.mjs', 'forks --paginate'],
  ['src/github-entity-validation.lib.mjs', 'branches --paginate'],
  ['src/solve.auto-continue.lib.mjs', 'branches'],
  ['src/bidirectional-interactive.lib.mjs', '--paginate --slurp'],
  ['src/solve.progress-monitoring.lib.mjs', 'gh pr view'],
  ['src/solve.minimal-restart-prompt.lib.mjs', 'git diff'],
  ['src/contributing-guidelines.lib.mjs', 'gh api repos'],
  ['src/github.lib.mjs', 'gh pr view'],
];

for (const [file, probe] of QUIETED_PROBES) {
  test(`${file} keeps its "${probe}" answer out of the log`, async () => {
    const source = await readFile(join(repoRoot, file), 'utf8');
    assert.ok(source.includes(probe), `${file} still contains the ${probe} probe this test guards`);
    assert.ok(/QUIET_PROBE|quietProbe/.test(source), `${file} applies the shared quiet-probe options`);
  });
}

test('contributing guidelines are read from the result, not from a chained .raw()', async () => {
  // `$` there is wrapped by wrapDollarWithGhRetry, which returns a plain promise
  // for `gh` commands. `.raw()` on it threw a TypeError that the surrounding
  // `catch` swallowed, so every repository looked as if it had no guidelines -
  // while the un-quieted probe still dumped ~70 KB of base64 into the log.
  const source = await readFile(join(repoRoot, 'src/contributing-guidelines.lib.mjs'), 'utf8');
  const code = source
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.ok(!code.includes('.raw()'), 'no .raw() is called on the retry-wrapped $');
  assert.ok(source.includes('checkResult.code === 0'), 'the exit code is read from the command-stream result');
});

// --- 3. a signalled child is reported as signalled ---------------------------

test('describeChildExit explains the abort that ended the captured session', () => {
  const message = describeChildExit({ command: 'solve', code: null, signal: 'SIGABRT' });
  assert.ok(message.includes('SIGABRT'), 'the signal is named');
  assert.ok(message.includes('heap'), 'the most likely cause - the V8 heap limit - is spelled out');
  assert.ok(!message.includes('code null'), 'the uninformative "code null" is gone');
});

test('describeChildExit keeps ordinary exits ordinary', () => {
  assert.equal(describeChildExit({ command: 'solve', code: 1 }), 'solve exited with code 1');
  assert.equal(describeChildExit({ command: 'solve', code: 0 }), 'solve exited with code 0');
  assert.ok(describeChildExit({ command: 'solve' }).includes('without a status code'));
  assert.ok(describeChildExit({ command: 'solve', code: null, signal: 'SIGWINCH' }).includes('SIGWINCH'), 'an unlisted signal is still named');
});

test('isLikelyOutOfMemoryExit recognises both ways a run dies of memory', () => {
  assert.equal(isLikelyOutOfMemoryExit({ code: null, signal: 'SIGABRT' }), true, 'node aborts on the V8 heap limit');
  assert.equal(isLikelyOutOfMemoryExit({ code: null, signal: 'SIGKILL' }), true, 'the kernel OOM killer, or a container limit');
  assert.equal(isLikelyOutOfMemoryExit({ code: 134 }), true, 'a shell reports SIGABRT as 128+6');
  assert.equal(isLikelyOutOfMemoryExit({ code: 1 }), false, 'an ordinary failure is not a memory failure');
  assert.equal(isLikelyOutOfMemoryExit({ code: null, signal: 'SIGTERM' }), false, 'a controlled stop is not a memory failure');
});

const runExitHandlers = emit => {
  const child = new EventEmitter();
  const logged = [];
  let result = null;
  attachChildExitHandlers({
    child,
    command: 'solve',
    label: '   [solve worker-1]',
    errorLabel: '   [solve worker-1 ERROR]',
    log: async (message, options) => logged.push({ message, options }),
    onExit: exit => {
      result = exit;
    },
  });
  emit(child);
  return { logged, result };
};

test('a child killed by a signal fails the worker instead of completing it', () => {
  const { logged, result } = runExitHandlers(child => child.emit('close', null, 'SIGABRT'));
  assert.equal(result.exitCode, 1, '`code || 0` used to turn the null of a signalled exit into a success');
  assert.equal(result.signal, 'SIGABRT');
  assert.equal(logged.length, 1, 'the reason is logged, once');
  assert.equal(logged[0].options.level, 'error');
  assert.ok(logged[0].message.startsWith('   [solve worker-1] '), 'the worker prefix is preserved');
  assert.ok(logged[0].message.includes('SIGABRT'));
});

test('an ordinary exit passes its code through untouched and says nothing extra', () => {
  assert.deepEqual(runExitHandlers(child => child.emit('close', 0, null)).result.exitCode, 0);
  assert.deepEqual(runExitHandlers(child => child.emit('close', 7, null)).result.exitCode, 7);
  assert.deepEqual(runExitHandlers(child => child.emit('close', 0, null)).logged, [], 'a clean exit is not narrated');
});

test('a spawn failure keeps the message it always had', () => {
  const { logged, result } = runExitHandlers(child => child.emit('error', new Error('spawn ENOENT')));
  assert.equal(result.exitCode, 1);
  assert.equal(logged[0].message, '   [solve worker-1 ERROR] Process error: spawn ENOENT');
});

test('every spawner reports the signal rather than interpolating a null code', async () => {
  for (const file of ['src/hive.mjs', 'src/fix.mjs', 'src/task.mjs', 'src/fix.ci-cd-issue.lib.mjs', 'src/isolation-runner.lib.mjs', 'src/telegram-command-execution.lib.mjs', 'src/session-kill-recovery.lib.mjs']) {
    const source = await readFile(join(repoRoot, file), 'utf8');
    assert.ok(/describeChildExit|attachChildExitHandlers/.test(source), `${file} describes how its child ended`);
    assert.ok(!/exited with code \$\{code\}/.test(source), `${file} no longer hard-codes "exited with code ${'${code}'}"`);
  }
});

// --- 4. the log says when it is running away ---------------------------------

test('the growth tracker warns once per threshold, naming the size reached', () => {
  const tracker = createLogGrowthTracker({ thresholds: [1024, 4096] });
  assert.equal(tracker.record(512), null, 'a small log is not worth a word');
  const first = tracker.record(512);
  assert.ok(first?.includes('1.0 KB'), 'the warning names the size actually reached');
  assert.ok(first.includes('issue-2135'), 'the warning points at the case study');
  assert.equal(tracker.record(1), null, 'the same threshold does not warn twice');
  assert.ok(tracker.record(4096)?.includes('KB'), 'the next threshold warns again');
  assert.equal(tracker.record(1_000_000), null, 'past the last threshold, it stays quiet');
});

test('one huge write produces one warning, not one per threshold it passed', () => {
  const tracker = createLogGrowthTracker({ thresholds: [1024, 2048, 4096] });
  const warning = tracker.record(8192);
  assert.ok(warning?.includes('8.0 KB'), 'the warning reports the total, not the threshold');
  assert.equal(tracker.record(8192), null, 'every threshold was consumed by that write');
  assert.equal(tracker.total(), 16384);
});

test('the tracker ignores non-writes', () => {
  const tracker = createLogGrowthTracker({ thresholds: [10] });
  assert.equal(tracker.record(0), null);
  assert.equal(tracker.record(-5), null);
  assert.equal(tracker.record(NaN), null);
  assert.equal(tracker.total(), 0);
});

test('setLogFile starts the accounting over for the new log', async () => {
  const source = await readFile(join(repoRoot, 'src/lib.mjs'), 'utf8');
  assert.ok(source.includes('resetLogGrowth()'), 'a new session log does not inherit the previous one size');
  assert.ok(source.includes('noteLogBytesWritten'), 'the append paths count what they write');
});

// --- 5. a failed development-log publication leaves no restart trigger --------
//
// RC6 of the case study: the publication rescan threw, the copies it had already
// written stayed untracked, watch mode read them as "the AI left uncommitted
// changes" and restarted the session with instructions to commit them - which is
// how hive-mind's own session log ended up inside the pull request diff.

// `$` in command-stream's options-call shape, recording the command of every
// call and answering from a per-command table.
const recordingGit$ = codes => {
  const commands = [];
  const tag =
    () =>
    (strings, ...values) => {
      const command = strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');
      commands.push(command.trim());
      const entry = Object.entries(codes).find(([prefix]) => command.trim().startsWith(prefix));
      return Promise.resolve({ code: entry ? entry[1] : 0, stdout: '', stderr: '' });
    };
  tag.commands = commands;
  return tag;
};

const publishInto = async (repositoryPath, $) => {
  const logPath = join(repositoryPath, 'session.log');
  await writeFile(logPath, 'a line of session log\n');
  return collectAndCommitDevelopmentLogArtifacts({
    enabled: true,
    repositoryPath,
    logFile: logPath,
    issueNumber: 191,
    prNumber: 192,
    tool: 'claude',
    sessionId: '2757eeb3-68e6-43bb-8a6a-20c55dfd2958',
    branchName: 'issue-191-abc',
    $,
    log: async () => {},
  });
};

test('a publication that cannot be staged discards its own copies', async t => {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'hive-2135-'));
  t.after(() => rm(repositoryPath, { recursive: true, force: true }));

  const $ = recordingGit$({ 'git add': 1 });
  const result = await publishInto(repositoryPath, $);

  assert.equal(result.committed, false);
  assert.equal(result.discarded, true);
  assert.ok(
    $.commands.some(command => command.startsWith('git reset -q --')),
    'anything already staged is unstaged too'
  );
  await assert.rejects(stat(join(repositoryPath, result.sessionRelativeDirectory)), { code: 'ENOENT' }, 'no untracked residue is left to trigger an auto-restart');
});

test('a publication that cannot be committed discards its own copies', async t => {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'hive-2135-'));
  t.after(() => rm(repositoryPath, { recursive: true, force: true }));

  // `git diff --cached --quiet` answers 1 when there is something staged.
  const result = await publishInto(repositoryPath, recordingGit$({ 'git diff --cached': 1, 'git commit': 128 }));

  assert.equal(result.committed, false);
  assert.equal(result.discarded, true);
  await assert.rejects(stat(join(repositoryPath, result.sessionRelativeDirectory)), { code: 'ENOENT' });
});

test('a publication that succeeds keeps its artifacts', async t => {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'hive-2135-'));
  t.after(() => rm(repositoryPath, { recursive: true, force: true }));

  const result = await publishInto(repositoryPath, recordingGit$({ 'git diff --cached': 1 }));

  assert.equal(result.committed, true);
  assert.equal(result.pushed, true);
  assert.ok(await stat(join(repositoryPath, result.sessionRelativeDirectory, 'solve.log')), 'the committed copy stays where it was committed from');
});

test('discarding is a no-op when there is nothing to discard', async () => {
  const $ = recordingGit$({});
  const outcome = await discardUnpublishedDevelopmentLog({ repositoryPath: '/tmp', sessionRelativeDirectory: '', $ });
  assert.deepEqual(outcome, { discarded: false, reason: 'nothing-to-discard' });
  assert.deepEqual($.commands, [], 'no git command is run for an empty cleanup');
});
