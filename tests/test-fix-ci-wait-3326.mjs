#!/usr/bin/env node

/**
 * Unit tests for `/fix` waiting for the default branch CI/CD before starting
 * `/solve`, and for the Telegram "waiting for CI/CD" status (issue #3326).
 *
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { FIX_CI_WAIT_DEFAULT_TIMEOUT_MINUTES, partitionFixArgs } from '../src/fix.args.lib.mjs';
import { buildCiWaitResultComment, commentCiWaitResult, selectPendingRuns, waitForDefaultBranchCi } from '../src/fix.ci-wait.lib.mjs';
import { FIX_PROGRESS_MARKER, fixProgressLogLine, formatDurationShort, formatFixProgressMessage, formatFixProgressStatus, parseFixProgressEvent, reportFixProgress } from '../src/fix-progress.lib.mjs';
import { formatExecutingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';
import { FIX_OWN_OPTIONS, validateFixCommandOptions } from '../src/telegram-fix-command.lib.mjs';
import { readFile } from 'node:fs/promises';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

const repository = { owner: 'owner', repo: 'repo', fullName: 'owner/repo' };

/**
 * Fake `gh` that serves one `actions/runs` snapshot per poll (the last one
 * repeats). A `null` snapshot simulates a failed `gh api` call.
 */
function createFakeActions({ snapshots, workflows = [{ id: 1, name: 'CI', state: 'active' }] }) {
  const calls = [];
  let poll = 0;
  const run = async (command, args) => {
    calls.push([command, ...args]);
    const endpoint = args[1] || '';
    if (args[0] === 'api' && endpoint.includes('/actions/workflows')) return { code: 0, stdout: JSON.stringify([{ workflows }]), stderr: '' };
    if (args[0] === 'api' && endpoint.includes('/actions/runs')) {
      const snapshot = snapshots[Math.min(poll, snapshots.length - 1)];
      poll += 1;
      if (snapshot === null) return { code: 1, stdout: '', stderr: 'HTTP 502' };
      return { code: 0, stdout: JSON.stringify({ workflow_runs: snapshot }), stderr: '' };
    }
    if (args[0] === 'issue' && args[1] === 'comment') return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: `unexpected: ${args.join(' ')}` };
  };
  return { run, calls };
}

function createClock(stepMs = 0) {
  let current = 1_000_000;
  return {
    now: () => current,
    sleep: async ms => {
      current += ms + stepMs;
    },
  };
}

const runOf = (id, status, extra = {}) => ({ id, name: 'CI', workflow_id: 1, status, conclusion: status === 'completed' ? 'success' : null, head_branch: 'main', head_sha: 'abcdef1234567', html_url: `https://github.com/owner/repo/actions/runs/${id}`, created_at: new Date(1_000_000 + id).toISOString(), ...extra });

await test('partitionFixArgs: waits for CI by default with a 60 minute timeout', () => {
  const parsed = partitionFixArgs(['owner/repo', '--ci-cd']);
  assert.equal(parsed.waitForCi, true);
  assert.equal(parsed.ciWaitTimeoutMinutes, FIX_CI_WAIT_DEFAULT_TIMEOUT_MINUTES);
  assert.equal(FIX_CI_WAIT_DEFAULT_TIMEOUT_MINUTES, 60);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.passthrough, []);
});

await test('partitionFixArgs: --no-wait-for-ci / --wait-for-ci / --ci-wait-timeout are consumed, not passed to solve', () => {
  const parsed = partitionFixArgs(['owner/repo', '--ci-cd', '--no-wait-for-ci', '--ci-wait-timeout', '15', '--model', 'opus']);
  assert.equal(parsed.waitForCi, false);
  assert.equal(parsed.ciWaitTimeoutMinutes, 15);
  assert.deepEqual(parsed.passthrough, ['--model', 'opus']);
  const inline = partitionFixArgs(['owner/repo', '--ci-cd', '--no-wait-for-ci', '--wait-for-ci', '--ci-wait-timeout=2.5']);
  assert.equal(inline.waitForCi, true);
  assert.equal(inline.ciWaitTimeoutMinutes, 2.5);
});

await test('partitionFixArgs: an invalid --ci-wait-timeout is reported as an error', () => {
  assert.deepEqual(partitionFixArgs(['owner/repo', '--ci-cd', '--ci-wait-timeout', 'abc']).errors, ['--ci-wait-timeout expects a number of minutes, got "abc"']);
  assert.deepEqual(partitionFixArgs(['owner/repo', '--ci-cd', '--ci-wait-timeout']).errors, ['--ci-wait-timeout expects a number of minutes, got nothing']);
  assert.deepEqual(partitionFixArgs(['owner/repo', '--ci-cd', '--ci-wait-timeout=-5']).errors, ['--ci-wait-timeout expects a number of minutes, got "-5"']);
});

await test('Telegram /fix validation accepts the CI wait options and rejects bad timeouts', async () => {
  for (const option of ['--wait-for-ci', '--no-wait-for-ci', '--ci-wait-timeout']) assert.ok(FIX_OWN_OPTIONS.includes(option), option);
  assert.equal(await validateFixCommandOptions(['https://github.com/owner/repo', '--ci-cd', '--no-wait-for-ci']), null);
  assert.equal(await validateFixCommandOptions(['https://github.com/owner/repo', '--ci-cd', '--ci-wait-timeout', '30']), null);
  assert.match(await validateFixCommandOptions(['https://github.com/owner/repo', '--ci-cd', '--ci-wait-timeout', 'soon']), /--ci-wait-timeout expects a number of minutes/);
  assert.match(await validateFixCommandOptions(['https://github.com/owner/repo', '--ci-cd', '--no-wait-for-cl']), /Did you mean "--no-wait-for-ci"\?/);
});

await test('selectPendingRuns keeps pending runs of active workflows only', () => {
  const runs = [runOf(1, 'in_progress'), runOf(2, 'completed'), runOf(3, 'queued', { workflow_id: 99, name: 'Disabled' }), runOf(4, 'waiting', { name: 'Deploy' })];
  assert.deepEqual(
    selectPendingRuns(runs, new Set([1])).map(item => [item.id, item.status]),
    [
      [1, 'in_progress'],
      [4, 'waiting'],
    ]
  );
  assert.equal(selectPendingRuns(runs, null).length, 3, 'unknown active workflows keep every pending run');
});

await test('waitForDefaultBranchCi: idle when nothing is pending (no sleep, no progress)', async () => {
  const github = createFakeActions({ snapshots: [[runOf(1, 'completed')]] });
  const clock = createClock();
  const progress = [];
  const result = await waitForDefaultBranchCi({ repository, branch: 'main', run: github.run, warn: () => {}, timeoutMs: 60_000, sleep: clock.sleep, now: clock.now, onProgress: event => progress.push(event) });
  assert.equal(result.outcome, 'idle');
  assert.equal(result.polls, 1);
  assert.equal(result.waitedMs, 0);
  assert.deepEqual(progress, []);
});

await test('waitForDefaultBranchCi: finished once pending runs complete, reporting each poll', async () => {
  const github = createFakeActions({ snapshots: [[runOf(1, 'queued')], [runOf(1, 'in_progress')], [runOf(1, 'completed')]] });
  const clock = createClock();
  const progress = [];
  const result = await waitForDefaultBranchCi({ repository, branch: 'main', run: github.run, warn: () => {}, timeoutMs: 10 * 60_000, intervalMs: 30_000, sleep: clock.sleep, now: clock.now, onProgress: event => progress.push(event) });
  assert.equal(result.outcome, 'finished');
  assert.equal(result.polls, 3);
  assert.equal(result.waitedMs, 60_000);
  assert.deepEqual(
    progress.map(event => [event.polls, event.pending[0].status, event.waitedMs]),
    [
      [1, 'queued', 0],
      [2, 'in_progress', 30_000],
    ]
  );
  const runsCalls = github.calls.filter(call => String(call[2]).includes('/actions/runs'));
  assert.equal(runsCalls.length, 3);
  assert.ok(runsCalls[0][2].includes('branch=main'), runsCalls[0][2]);
});

await test('waitForDefaultBranchCi: gives up at the timeout and never sleeps past it', async () => {
  const github = createFakeActions({ snapshots: [[runOf(1, 'in_progress')]] });
  const clock = createClock();
  const sleeps = [];
  const result = await waitForDefaultBranchCi({
    repository,
    branch: 'main',
    run: github.run,
    warn: () => {},
    timeoutMs: 70_000,
    intervalMs: 30_000,
    sleep: async ms => {
      sleeps.push(ms);
      await clock.sleep(ms);
    },
    now: clock.now,
  });
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.waitedMs, 70_000);
  assert.deepEqual(sleeps, [30_000, 30_000, 10_000]);
  assert.equal(result.pending[0].id, 1);
});

await test('waitForDefaultBranchCi: unknown after repeated failed polls, recovers from a single failure', async () => {
  const clock = createClock();
  const failing = createFakeActions({ snapshots: [null] });
  const unknown = await waitForDefaultBranchCi({ repository, branch: 'main', run: failing.run, warn: () => {}, timeoutMs: 60 * 60_000, sleep: clock.sleep, now: clock.now });
  assert.equal(unknown.outcome, 'unknown');
  assert.equal(unknown.polls, 3);

  const flaky = createFakeActions({ snapshots: [[runOf(1, 'in_progress')], null, [runOf(1, 'completed')]] });
  const finished = await waitForDefaultBranchCi({ repository, branch: 'main', run: flaky.run, warn: () => {}, timeoutMs: 60 * 60_000, sleep: clock.sleep, now: clock.now });
  assert.equal(finished.outcome, 'finished');

  const noBranch = await waitForDefaultBranchCi({ repository, branch: null, run: flaky.run, warn: () => {}, timeoutMs: 1000 });
  assert.equal(noBranch.outcome, 'unknown');
});

await test('buildCiWaitResultComment lists the latest run per workflow, with a timeout variant', () => {
  const runs = [runOf(2, 'completed', { conclusion: 'failure' }), runOf(1, 'completed'), runOf(3, 'in_progress', { workflow_id: 2, name: 'Deploy' })];
  const finished = buildCiWaitResultComment({ branch: 'main', result: { outcome: 'finished', runs, waitedMs: 120_000 } });
  assert.match(finished, /^## CI\/CD on `main` finished before work started/);
  assert.match(finished, /- \[CI\]\(https:\/\/github\.com\/owner\/repo\/actions\/runs\/2\): `failure` at `abcdef1`/);
  assert.match(finished, /- \[Deploy\]\(.*\/runs\/3\): `in_progress`/);
  assert.doesNotMatch(finished, /runs\/1\)/, 'older runs of the same workflow are deduplicated');
  const timeout = buildCiWaitResultComment({ branch: 'main', result: { outcome: 'timeout', runs: [], waitedMs: 30 * 60_000 } });
  assert.match(timeout, /was still running when work started/);
  assert.match(timeout, /waited 30 minute\(s\)/);
  assert.match(timeout, /_No runs found._/);
});

await test('commentCiWaitResult posts through gh issue comment --body-file and is best effort', async () => {
  const github = createFakeActions({ snapshots: [[]] });
  assert.equal(await commentCiWaitResult({ issueUrl: 'https://github.com/owner/repo/issues/7', branch: 'main', result: { outcome: 'finished', runs: [runOf(1, 'completed')] }, run: github.run, warn: () => {} }), true);
  const call = github.calls.find(entry => entry[1] === 'issue');
  assert.deepEqual(call.slice(0, 4), ['gh', 'issue', 'comment', 'https://github.com/owner/repo/issues/7']);
  assert.equal(call[4], '--body-file');
  const warnings = [];
  assert.equal(await commentCiWaitResult({ issueUrl: 'x', branch: 'main', result: { outcome: 'finished', runs: [] }, run: async () => ({ code: 1, stdout: '', stderr: 'boom' }), warn: message => warnings.push(message) }), false);
  assert.match(warnings[0], /boom/);
});

await test('fix progress markers round-trip and the latest valid one wins', () => {
  const line = fixProgressLogLine({ phase: 'waiting-for-ci', branch: 'main', pending: [{ name: 'CI', status: 'queued' }], waitedMs: 0 });
  assert.ok(line.startsWith(`${FIX_PROGRESS_MARKER} {`));
  const log = ['noise', fixProgressLogLine({ phase: 'issue-created', issueUrl: 'https://github.com/owner/repo/issues/3' }), `[2026-10-15T00:00:00Z] [INFO] ${line}`, `${FIX_PROGRESS_MARKER} {broken`, `echo "${FIX_PROGRESS_MARKER} {\\"phase\\":\\"solving\\"}"`, `${FIX_PROGRESS_MARKER} {"phase":"other"}`].join('\n');
  const event = parseFixProgressEvent(log);
  assert.equal(event.phase, 'waiting-for-ci');
  assert.equal(event.pending[0].status, 'queued');
  assert.equal(parseFixProgressEvent('nothing here'), null);
});

await test('formatDurationShort', () => {
  assert.equal(formatDurationShort(0), '0s');
  assert.equal(formatDurationShort(45_000), '45s');
  assert.equal(formatDurationShort(210_000), '3m 30s');
  assert.equal(formatDurationShort(3_600_000), '1h 0m');
});

await test('formatFixProgressStatus shows a separate waiting-for-CI/CD status', () => {
  const waiting = formatFixProgressStatus({ phase: 'waiting-for-ci', branch: 'main', pending: [{ name: 'CI/CD Pipeline', status: 'in_progress' }], waitedMs: 90_000, timeoutMs: 3_600_000, issueUrl: 'https://github.com/owner/repo/issues/3' });
  assert.match(waiting, /^⏳ Waiting for CI\/CD on `main` to finish before starting the task\.\.\./);
  assert.match(waiting, /🔄 Running: `CI\/CD Pipeline` \(in_progress\)/);
  assert.match(waiting, /⏱ Waited 1m 30s of 1h 0m/);
  assert.match(waiting, /📝 Issue: https:\/\/github\.com\/owner\/repo\/issues\/3/);
  assert.match(formatFixProgressStatus({ phase: 'ci-finished', branch: 'main', outcome: 'finished', waitedMs: 120_000 }), /✅ CI\/CD on `main` finished \(2m 0s\)/);
  assert.match(formatFixProgressStatus({ phase: 'ci-finished', branch: 'main', outcome: 'timeout', timeoutMs: 1_800_000 }), /still running after 30m 0s; starting the task anyway/);
  const solving = formatFixProgressStatus({ phase: 'solving', branch: 'main', ciOutcome: 'idle', issueUrl: 'https://github.com/owner/repo/issues/3' });
  assert.match(solving, /^⏳ Executing\.\.\.\n✅ No CI\/CD running on `main`/);
  assert.match(formatFixProgressStatus({ phase: 'solving', branch: 'main', ciOutcome: 'skipped' }), /--no-wait-for-ci/);
  assert.equal(formatFixProgressStatus(null), null);
});

await test('formatFixProgressStatus is localized (ru)', async () => {
  const { loadTranslations } = await import('../src/i18n.lib.mjs');
  await loadTranslations('ru');
  const waiting = formatFixProgressStatus({ phase: 'waiting-for-ci', branch: 'main', pending: [], waitedMs: 0, timeoutMs: 60_000 }, { locale: 'ru' });
  assert.doesNotMatch(waiting, /Waiting for CI\/CD/);
  assert.match(waiting, /`main`/);
});

await test('formatExecutingWorkSessionMessage accepts a custom status header', () => {
  const plain = formatExecutingWorkSessionMessage({ sessionName: 's1', infoBlock: 'Repo: x' });
  assert.match(plain, /^⏳ Executing\.\.\./);
  const custom = formatExecutingWorkSessionMessage({ sessionName: 's1', infoBlock: 'Repo: x', header: '⏳ Waiting for CI/CD' });
  assert.match(custom, /^⏳ Waiting for CI\/CD/);
  assert.equal(custom.replace('⏳ Waiting for CI/CD', '⏳ Executing...'), plain);
  assert.equal(formatFixProgressMessage({ event: { phase: 'issue-created' }, sessionName: 's1', sessionInfo: { infoBlock: 'Repo: x' } }), formatExecutingWorkSessionMessage({ sessionName: 's1', infoBlock: 'Repo: x', header: '📝 Issue created, preparing to start the task...' }));
});

function createMockBot() {
  const edits = [];
  return {
    edits,
    telegram: {
      editMessageText: async (chatId, messageId, inlineId, text, extra) => {
        edits.push({ chatId, messageId, text, extra });
        return true;
      },
    },
  };
}

await test('reportFixProgress edits the /fix reply, dedupes and stops after the solving phase', async () => {
  const bot = createMockBot();
  const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, infoBlock: 'Repository: owner/repo', isolationBackend: 'docker' };
  let log = fixProgressLogLine({ phase: 'waiting-for-ci', branch: 'main', pending: [{ name: 'CI', status: 'queued' }], waitedMs: 0, timeoutMs: 60_000, issueUrl: 'https://github.com/owner/repo/issues/3' });
  const reads = [];
  const readTail = async (logPath, options) => {
    reads.push([logPath, options.maxBytes]);
    return log;
  };
  let persisted = 0;
  const persist = () => persisted++;
  const statusResult = { logPath: '/tmp/fix.log' };
  assert.ok(await reportFixProgress({ bot, sessionName: 's1', sessionInfo, statusResult, readTail, persist }));
  assert.equal(bot.edits.length, 1);
  assert.match(bot.edits[0].text, /Waiting for CI\/CD on/);
  assert.equal(sessionInfo.fixProgress.phase, 'waiting-for-ci');
  assert.equal(await reportFixProgress({ bot, sessionName: 's1', sessionInfo, statusResult, readTail, persist }), null, 'the same event is not re-sent');
  assert.equal(bot.edits.length, 1);

  log += `\n${fixProgressLogLine({ phase: 'solving', branch: 'main', ciOutcome: 'finished', waitedMs: 120_000, issueUrl: 'https://github.com/owner/repo/issues/3' })}`;
  await reportFixProgress({ bot, sessionName: 's1', sessionInfo, statusResult, readTail, persist });
  assert.equal(bot.edits.length, 2);
  assert.match(bot.edits[1].text, /^⏳ Executing\.\.\./);
  assert.equal(sessionInfo.fixProgress.done, true);
  assert.match(sessionInfo.infoBlock, /Issue: https:\/\/github\.com\/owner\/repo\/issues\/3$/, 'the issue link survives in the completion message');
  const readsBefore = reads.length;
  await reportFixProgress({ bot, sessionName: 's1', sessionInfo, statusResult, readTail, persist });
  assert.equal(reads.length, readsBefore, 'no log reads once done');
  assert.equal(persisted, 2);
  assert.deepEqual(reads[0], ['/tmp/fix.log', 32768]);
});

await test('reportFixProgress ignores non-/fix sessions, missing logs and never throws', async () => {
  const bot = createMockBot();
  const readTail = async () => fixProgressLogLine({ phase: 'issue-created' });
  assert.equal(await reportFixProgress({ bot, sessionName: 's', sessionInfo: { command: 'solve', chatId: 1, messageId: 2 }, statusResult: { logPath: '/x' }, readTail }), null);
  assert.equal(await reportFixProgress({ bot, sessionName: 's', sessionInfo: { command: 'fix', chatId: 1, messageId: 2 }, statusResult: {}, readTail }), null);
  const throwing = { telegram: { editMessageText: async () => Promise.reject(new Error('Bad Request: chat not found')) } };
  const sessionInfo = { command: 'fix', chatId: 1, messageId: 2 };
  assert.equal(await reportFixProgress({ bot: throwing, sessionName: 's', sessionInfo, statusResult: { logPath: '/x' }, readTail }), null);
  assert.equal(sessionInfo.fixProgress, undefined, 'a failed edit is retried on the next tick');
  assert.equal(await reportFixProgress({ bot, sessionName: 's', sessionInfo: { command: 'fix', chatId: 1, messageId: 2 }, statusResult: { logPath: '/x' }, readTail: async () => Promise.reject(new Error('EACCES')) }), null);
  assert.equal(bot.edits.length, 0);
});

await test('reportFixProgress marks progress done once markers scroll out of the tail', async () => {
  const bot = createMockBot();
  const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, fixProgress: { phase: 'waiting-for-ci', key: 'k' } };
  assert.equal(await reportFixProgress({ bot, sessionName: 's', sessionInfo, statusResult: { logPath: '/x' }, readTail: async () => 'solve output only' }), null);
  assert.equal(sessionInfo.fixProgress.done, true);
});

await test('session monitor calls reportFixProgress for running sessions', async () => {
  const source = await readFile(new URL('../src/session-monitor.lib.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ reportFixProgress \} from '\.\/fix-progress\.lib\.mjs'/);
  assert.match(source, /if \(stillRunning && sessionInfo\?\.command === 'fix'[^\n]*reportFixProgress\)\(\{ bot, sessionName, sessionInfo, statusResult/);
});

await test('fix.mjs waits for CI between creating the issue and starting solve', async () => {
  const source = await readFile(new URL('../src/fix.mjs', import.meta.url), 'utf8');
  const created = source.indexOf("phase: 'issue-created'");
  const wait = source.indexOf('waitForDefaultBranchCi(');
  const solving = source.indexOf("phase: 'solving'");
  assert.ok(created > 0 && wait > created && solving > wait, `order: created=${created} wait=${wait} solving=${solving}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
