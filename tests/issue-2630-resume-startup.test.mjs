/**
 * Bounded Docker startup inspection and removal of failed resume artifacts.
 * @hive-mind-test-suite default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as startup from '../src/isolation-runner.resume.lib.mjs';
import { reportRecoveryLifecycle } from '../src/session-recovery-lifecycle.lib.mjs';
import { announcePendingKillNotice, finishKillNotice } from '../src/session-monitor.kill-notice.lib.mjs';
import { createGhCommentRecorder } from './helpers/gh-comment-recorder.mjs';

function probe(states) {
  let elapsed = 0;
  const calls = [];
  return {
    calls,
    options: {
      now: () => elapsed,
      sleep: async ms => {
        elapsed += ms;
      },
      run: async (_binary, args) => {
        calls.push(args);
        const state = states.length > 1 ? states.shift() : states[0];
        return { stdout: JSON.stringify(state) };
      },
    },
  };
}

const terminal = (exitCode, seconds = 2) => ({ Running: false, Status: 'exited', ExitCode: exitCode, StartedAt: '2026-10-07T09:54:10Z', FinishedAt: `2026-10-07T09:54:${10 + seconds}Z` });

for (const exitCode of [126, 127]) {
  test(`startup catches exit ${exitCode} after entrypoint startup`, async () => {
    const p = probe([{ Running: true, Status: 'running' }, terminal(exitCode)]);
    const result = await startup.checkResumedDockerStartup('original-resume-1', p.options);
    assert.equal(result.failed, true);
    assert.equal(result.exitCode, exitCode);
    assert.match(result.error, /automatic recovery could not start/i);
    assert.equal(p.calls.length, 2);
  });
}

for (const state of [terminal(0), terminal(1), terminal(137), terminal(127, 30)]) {
  test(`exit ${state.ExitCode} at ${state.FinishedAt} does not trigger a startup fallback`, async () => {
    assert.equal((await startup.checkResumedDockerStartup('original-resume-1', probe([state]).options)).failed, false);
  });
}

test('a running recovery leaves the finite observation window', async () => {
  const p = probe([{ Running: true, Status: 'running' }]);
  assert.equal((await startup.checkResumedDockerStartup('original-resume-1', { ...p.options, waitMs: 1000, pollMs: 250 })).failed, false);
  assert.equal(p.calls.length, 5);
});

test('created state exit code zero is not mistaken for a completed recovery', async () => {
  const p = probe([{ Running: false, Status: 'created', ExitCode: 0 }, terminal(127)]);
  assert.equal((await startup.checkResumedDockerStartup('original-resume-1', p.options)).failed, true);
});

test('an unavailable Docker inspect does not start duplicate work', async () => {
  const result = await startup.checkResumedDockerStartup('original-resume-1', {
    run: async () => {
      throw new Error('daemon unreachable');
    },
  });
  assert.equal(result.failed, false);
});

const snapshot = { mode: 'docker-snapshot', sessionName: 'original-resume-1', previousSessionName: 'original', snapshotImage: 'start-command-resume/original:1' };

test('cleanup removes only the returned derived container and then its image', async () => {
  const calls = [];
  const result = await startup.cleanupFailedResumeSnapshot(snapshot, {
    run: async (binary, args) => {
      calls.push({ binary, args });
      return { stdout: '' };
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls, [
    { binary: 'docker', args: ['rm', 'original-resume-1'] },
    { binary: 'docker', args: ['image', 'rm', 'start-command-resume/original:1'] },
  ]);
});

test('cleanup preserves the original container and unrelated images', async () => {
  let calls = 0;
  const run = async () => {
    calls++;
    return { stdout: '' };
  };
  for (const result of [
    { ...snapshot, sessionName: 'original' },
    { ...snapshot, snapshotImage: 'konard/hive-mind:latest' },
    { ...snapshot, mode: 'docker-start' },
  ]) {
    assert.equal((await startup.cleanupFailedResumeSnapshot(result, { run })).success, false);
  }
  assert.equal(calls, 0);
});

test('cleanup failures identify both retained artifacts', async () => {
  const result = await startup.cleanupFailedResumeSnapshot(snapshot, {
    run: async () => {
      throw new Error('daemon unreachable');
    },
  });
  assert.equal(result.success, false);
  assert.match(result.error, /original-resume-1/);
  assert.match(result.error, /start-command-resume\/original:1/);
});

test('same-phase fallback reasons reach Telegram, and never GitHub (issue #3530)', async () => {
  const gh = createGhCommentRecorder();
  const edits = [];
  const sessionInfo = { chatId: 1, messageId: 2, startTime: new Date(), command: 'solve', args: [], url: 'https://github.com/link-assistant/hive-mind/pull/2632' };
  const context = {
    sessionName: 'original',
    sessionInfo,
    pullRequestUrl: sessionInfo.url,
    phase: 'launching',
    attempt: 1,
    bot: { telegram: { editMessageText: async (_chat, _id, _inline, body) => edits.push(body) } },
    options: { runCommand: gh.runCommand },
  };
  await reportRecoveryLifecycle(context);
  const reason = 'automatic recovery could not start: exit 127. Starting a fresh isolated session.';
  await reportRecoveryLifecycle({ ...context, reason });
  assert.equal(edits.length, 2);
  assert.ok(edits[1].includes(reason));
  assert.equal(gh.calls.length, 0, 'lifecycle phases are Telegram only');
});

test('without a pull request, the kill notice and the reason a recovery could not start go to the issue', async () => {
  const gh = createGhCommentRecorder();
  const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/2630';
  const sessionInfo = { chatId: 1, messageId: 2, startTime: new Date(), command: 'solve', args: [issueUrl, '--on-session-kill', 'resume'], url: issueUrl, urlContext: { owner: 'link-assistant', repo: 'hive-mind', number: 2630, type: 'issue', normalized: issueUrl } };
  const context = {
    pullRequestUrl: null,
    sessionName: 'original',
    sessionInfo,
    killReport: { killed: true, diagnosis: { cause: 'out-of-memory', summary: 'The container was OOM-killed.', evidence: [] }, observedAt: '2026-10-07T09:54:00Z', policy: 'resume' },
    exitCode: 137,
    options: { runCommand: gh.runCommand },
  };
  // Routine progress stays on Telegram.
  await reportRecoveryLifecycle({ sessionName: 'original', sessionInfo, attempt: 1, phase: 'waiting', delayMs: 0, bot: { telegram: { editMessageText: async () => {} } }, options: context.options });
  assert.equal(gh.calls.length, 0);
  const pending = await announcePendingKillNotice(context);
  assert.equal(pending.posted, true);
  assert.deepEqual(gh.calls[0].slice(0, 4), ['gh', 'issue', 'comment', issueUrl]);
  assert.equal(sessionInfo.killNotice.url, `${issueUrl}#issuecomment-1`);
  const reason = 'Automatic recovery could not start: container original-resume-1 exited with code 127 after 1 seconds.';
  await finishKillNotice({ ...context, killRecovery: { resumed: false, reason: 'launch-failed', detail: reason } });
  // The issue comment is edited instead of adding another one.
  assert.equal(gh.posts.length, 1);
  assert.equal(gh.patches.length, 1);
  assert.ok(gh.current()[0].includes(reason));
  assert.doesNotMatch(gh.current()[0], /is pending/);
  // A repeated completion (e.g. after a bot restart) neither posts nor edits again.
  await announcePendingKillNotice(context);
  await finishKillNotice({ ...context, killRecovery: { resumed: false, reason: 'launch-failed', detail: reason } });
  assert.equal(gh.posts.length, 1);
  assert.equal(gh.patches.length, 1);
});
