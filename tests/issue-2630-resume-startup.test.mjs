/**
 * Bounded Docker startup inspection and removal of failed resume artifacts.
 * @hive-mind-test-suite default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as startup from '../src/isolation-runner.resume.lib.mjs';
import { reportRecoveryLifecycle } from '../src/session-recovery-lifecycle.lib.mjs';

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

test('same-phase fallback reasons reach both GitHub and Telegram', async () => {
  const comments = [],
    edits = [];
  const sessionInfo = { chatId: 1, messageId: 2, startTime: new Date(), command: 'solve', args: [], url: 'https://github.com/link-assistant/hive-mind/pull/2632' };
  const context = {
    sessionName: 'original',
    sessionInfo,
    pullRequestUrl: sessionInfo.url,
    phase: 'launching',
    attempt: 1,
    bot: { telegram: { editMessageText: async (_chat, _id, _inline, body) => edits.push(body) } },
    options: {
      runCommand: async (_binary, args) => {
        const { readFile } = await import('node:fs/promises');
        const editing = args.includes('--input');
        const body = await readFile(args[args.indexOf(editing ? '--input' : '--body-file') + 1], 'utf8');
        comments.push(editing ? JSON.parse(body).body : body);
        return { code: 0, stdout: `${sessionInfo.url}#issuecomment-123`, stderr: '' };
      },
    },
  };
  await reportRecoveryLifecycle(context);
  const reason = 'automatic recovery could not start: exit 127. Starting a fresh isolated session.';
  await reportRecoveryLifecycle({ ...context, reason });
  assert.equal(comments.length, 2);
  assert.equal(edits.length, 2);
  assert.ok(comments[1].includes(reason));
  assert.ok(edits[1].includes(reason));
});
