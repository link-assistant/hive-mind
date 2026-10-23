/**
 * @hive-mind-test-suite default
 * A kill recovery that needs a new container stays the same start-command
 * execution: `$ --session <new container> --session-id <task uuid>
 * --append-attempt` (start-command >= 0.38.0, start#229), so the task keeps
 * one UUID and one log (issue #3530).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionIdentityArgs, startCommandSupportsAppendAttempt, createClaudeTaskSessionIdClaimer } from '../src/task-session-id.lib.mjs';
import { buildStartCommandArgs } from '../src/isolation-runner.lib.mjs';
import { startKillRecoverySession, isAppendAttemptRefusal } from '../src/session-kill-resume.lib.mjs';
import { recoveryLogStartOffset } from '../src/session-recovery-footer.lib.mjs';

const PR = 'https://github.com/link-foundation/legal/pull/2';
const TASK = '6bf35d99-0000-4000-8000-000000003530';
const FRESH = '2b185a46-0000-4000-8000-000000003530';

test('the identity flags name the container and the execution separately for an appended attempt', () => {
  assert.deepEqual(buildSessionIdentityArgs(TASK), ['--session', TASK, '--session-id', TASK]);
  assert.deepEqual(buildSessionIdentityArgs(FRESH, { executionId: TASK, appendAttempt: true }), ['--session', FRESH, '--session-id', TASK, '--append-attempt']);
  // --append-attempt without an explicit execution id is refused by `$`, so it is never sent.
  assert.deepEqual(buildSessionIdentityArgs(FRESH, { appendAttempt: true }), ['--session', FRESH, '--session-id', FRESH]);
});

test('only start-command 0.38.0 and later can append an attempt', () => {
  assert.equal(startCommandSupportsAppendAttempt('0.38.0'), true);
  assert.equal(startCommandSupportsAppendAttempt('start-command 0.39.2'), true);
  assert.equal(startCommandSupportsAppendAttempt('0.37.9'), false);
  assert.equal(startCommandSupportsAppendAttempt(null), false);
});

test('the screen launch of an appended attempt passes the task id to solve, not the new session name', async () => {
  const args = await buildStartCommandArgs('solve', [PR], { backend: 'screen', sessionId: FRESH, executionId: TASK, appendAttempt: true });
  assert.deepEqual(args.slice(0, 8), ['--isolated', 'screen', '--detached', '--session', FRESH, '--session-id', TASK, '--append-attempt']);
  assert.match(args.at(-1), new RegExp(`^HIVE_MIND_TASK_SESSION_ID='${TASK}' 'solve' `));
});

test('a recovery attempt does not hand the task id to a new Claude session', async () => {
  const env = { HIVE_MIND_TASK_SESSION_ID: TASK };
  assert.deepEqual(await createClaudeTaskSessionIdClaimer()({ env, homeDir: '/nonexistent' }), ['--session-id', TASK]);
  assert.deepEqual(await createClaudeTaskSessionIdClaimer()({ env: { ...env, START_ATTEMPT: '2' }, homeDir: '/nonexistent' }), []);
});

const recover = async ({ version, results }) => {
  const launches = [];
  const tracked = [];
  const queue = [...results];
  const result = await startKillRecoverySession({
    sessionName: TASK,
    sessionInfo: { startTime: new Date(0), isolationBackend: 'screen', args: [PR], url: PR, tool: 'codex', executionUuid: TASK, logPath: '/nonexistent/task.log' },
    plan: { shouldResume: true, attempt: 1, maxAttempts: 3, command: { binary: 'solve', args: [PR], display: `solve ${PR}` } },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    skipInPlace: 'test: no in-place resume',
    resolveFreshCommand: async ({ command }) => ({ command, outcome: null }),
    runner: {
      generateSessionId: () => FRESH,
      getStartCommandVersion: async () => version,
      executeWithIsolation: async (binary, args, options) => (launches.push(options), queue.shift()),
    },
    trackSession: (id, info) => tracked.push({ id, info }),
  });
  return { result, launches, tracked };
};

test('start-command 0.38: the fresh container is the next attempt of the same execution and log', async () => {
  const { result, launches, tracked } = await recover({ version: '0.38.0', results: [{ success: true, executionUuid: TASK }] });
  assert.equal(result.resumed, true);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].sessionId, FRESH);
  assert.equal(launches[0].executionId, TASK);
  assert.equal(launches[0].appendAttempt, true);
  const { id, info } = tracked[0];
  assert.equal(id, FRESH);
  assert.equal(info.containerName, FRESH);
  assert.equal(info.executionUuid, TASK, 'one UUID for the whole task');
  assert.deepEqual(info.previousExecutionUuids, [], 'no second log to chain');
  assert.equal(info.logPath, '/nonexistent/task.log', 'the attempt writes on into the same log');
  assert.equal(info.killRecoveryAppendedAttempt, true);
  assert.equal(info.killRecoveryInPlace, false);
});

test('an older start-command still gets a new execution UUID, chained to the previous one', async () => {
  const { launches, tracked } = await recover({ version: '0.37.9', results: [{ success: true, executionUuid: FRESH }] });
  assert.equal(launches[0].executionId, undefined);
  assert.equal(launches[0].appendAttempt, undefined);
  assert.equal(tracked[0].info.executionUuid, FRESH);
  assert.deepEqual(tracked[0].info.previousExecutionUuids, [TASK]);
  assert.equal(tracked[0].info.killRecoveryAppendedAttempt, false);
});

test('a refused append falls back to a new execution, but "still running" never launches a second copy', async () => {
  const refused = `execution id ${TASK} is already used as a name of execution 0000; pick another --session-id`;
  const fallback = await recover({
    version: '0.38.0',
    results: [
      { success: false, error: refused },
      { success: true, executionUuid: FRESH },
    ],
  });
  assert.equal(fallback.launches.length, 2);
  assert.equal(fallback.launches[1].appendAttempt, undefined);
  assert.equal(fallback.tracked[0].info.executionUuid, FRESH);
  assert.equal(fallback.tracked[0].info.killRecoveryAppendedAttempt, false);

  const running = `execution ${TASK} is still running; wait for it to finish or use $ --stop ${TASK} before --append-attempt`;
  assert.equal(isAppendAttemptRefusal(refused), true);
  assert.equal(isAppendAttemptRefusal(running), false);
  const blocked = await recover({ version: '0.38.0', results: [{ success: false, error: running }] });
  assert.equal(blocked.launches.length, 1);
  assert.equal(blocked.result.resumed, false);
});

test('an appended attempt reads its own part of the shared log, like an in-place resume', () => {
  assert.equal(recoveryLogStartOffset({ killRecoveryAppendedAttempt: true, killRecoveryLogStartBytes: 2461 }), 2461);
  assert.equal(recoveryLogStartOffset({ killRecoveryInPlace: true, killRecoveryLogStartBytes: 10 }), 10);
  assert.equal(recoveryLogStartOffset({ killRecoveryLogStartBytes: 2461 }), 0);
});
