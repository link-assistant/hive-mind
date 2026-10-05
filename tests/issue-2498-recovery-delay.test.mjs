/**
 * @hive-mind-test-suite default
 * Issue #2498 (PR #2499 review): one out-of-memory event can kill several work sessions, or the
 * tool processes of several runs, at the same moment. Recovering all of them in the same second
 * sends every recovery at the same memory, CPUs and API at once, so each automatic recovery waits
 * its own random delay — 30 to 90 seconds by default — before it starts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SESSION_KILL_RESUME_DELAY_RANGE, SESSION_KILL_RESUME_DELAY_ENV_VAR, resolveSessionKillResumeDelayRange, pickSessionKillResumeDelayMs } from '../src/session-kill-policy.lib.mjs';
import { recoverKilledSession } from '../src/session-kill-resume.lib.mjs';
import { resumeAfterToolKill } from '../src/solve.tool-kill-resume.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';

const PR_URL = 'https://github.com/link-foundation/meta-language/pull/196';
const TOOL_SESSION = '48959e41-0000-4000-8000-000000000196';

test('the default delay is a random 30–90 seconds', () => {
  assert.deepEqual({ ...DEFAULT_SESSION_KILL_RESUME_DELAY_RANGE }, { minSeconds: 30, maxSeconds: 90 });
  assert.equal(pickSessionKillResumeDelayMs({ env: {}, random: () => 0 }), 30_000);
  assert.equal(pickSessionKillResumeDelayMs({ env: {}, random: () => 0.5 }), 60_000);
  assert.equal(pickSessionKillResumeDelayMs({ env: {}, random: () => 0.999999 }), 90_000);
  for (let i = 0; i < 200; i++) {
    const ms = pickSessionKillResumeDelayMs({ env: {} });
    assert.ok(ms >= 30_000 && ms <= 90_000, `${ms} ms is inside 30–90 s`);
  }
});

test('the delay is configurable by flag or environment, and 0 turns it off', () => {
  assert.equal(SESSION_KILL_RESUME_DELAY_ENV_VAR, 'HIVE_MIND_SESSION_KILL_RESUME_DELAY');
  assert.deepEqual(resolveSessionKillResumeDelayRange({ env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '10-20' } }), { minSeconds: 10, maxSeconds: 20 });
  assert.deepEqual(resolveSessionKillResumeDelayRange({ env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '45' } }), { minSeconds: 45, maxSeconds: 45 });
  assert.deepEqual(resolveSessionKillResumeDelayRange({ env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' } }), { minSeconds: 0, maxSeconds: 0 });
  assert.deepEqual(resolveSessionKillResumeDelayRange({ env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '90-30' } }), { minSeconds: 30, maxSeconds: 90 }, 'a reversed range is normalised');
  assert.deepEqual(resolveSessionKillResumeDelayRange({ env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: 'soon' } }), { minSeconds: 30, maxSeconds: 90 }, 'garbage falls back to the default');
  assert.deepEqual(resolveSessionKillResumeDelayRange({ argv: { 'session-kill-resume-delay': '5-6' }, env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' } }), { minSeconds: 5, maxSeconds: 6 }, 'the flag wins over the environment');
});

test('parsed CLI defaults allow the environment delay and explicit flags override it', () => {
  const parse = args => getLinoYargsFactory()().options(SOLVE_OPTION_DEFINITIONS).parse(args);
  const env = { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' };
  assert.deepEqual(resolveSessionKillResumeDelayRange({ argv: parse([]), env }), { minSeconds: 0, maxSeconds: 0 });
  assert.deepEqual(resolveSessionKillResumeDelayRange({ argv: parse(['--session-kill-resume-delay', '5-6']), env }), { minSeconds: 5, maxSeconds: 6 });
});

test('non-finite and overflowing timer delays fall back to the default', () => {
  for (const value of ['9'.repeat(400), '2147484', '1-2147484']) {
    assert.deepEqual(resolveSessionKillResumeDelayRange({ env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: value } }), { minSeconds: 30, maxSeconds: 90 });
  }
});

function killedSession(name) {
  return { command: 'solve', isolationBackend: 'screen', sessionId: name, url: PR_URL, args: [PR_URL], tool: 'claude' };
}

test('a recovery session starts only after its random delay', async () => {
  const events = [];
  const runner = { generateSessionId: () => 'recovery-1', executeWithIsolation: async () => (events.push('launch'), { success: true }) };
  const result = await recoverKilledSession({
    sessionName: 'killed-1',
    sessionInfo: killedSession('killed-1'),
    killed: true,
    env: {},
    runner,
    trackSession: () => events.push('track'),
    readLastSessionId: () => TOOL_SESSION,
    random: () => 0.25,
    sleep: async ms => events.push(`sleep ${ms}`),
  });
  assert.equal(result.resumed, true);
  assert.deepEqual(events, ['sleep 45000', 'launch', 'track'], 'the wait comes before the launch');
});

test('sessions killed by one OOM event are not restarted at the same moment', async () => {
  const delays = [];
  const randoms = [0.1, 0.9, 0.5];
  for (const [index, name] of ['killed-a', 'killed-b', 'killed-c'].entries()) {
    await recoverKilledSession({
      sessionName: name,
      sessionInfo: killedSession(name),
      killed: true,
      env: {},
      runner: { generateSessionId: () => `recovery-${name}`, executeWithIsolation: async () => ({ success: true }) },
      trackSession: () => {},
      readLastSessionId: () => TOOL_SESSION,
      random: () => randoms[index],
      sleep: async ms => delays.push(ms),
    });
  }
  assert.deepEqual(delays, [36_000, 84_000, 60_000]);
  assert.equal(new Set(delays).size, 3, 'each recovery gets its own delay');
});

test('a delay of 0 starts the recovery immediately, and a refused plan never waits', async () => {
  const sleeps = [];
  const runner = { generateSessionId: () => 'recovery-2', executeWithIsolation: async () => ({ success: true }) };
  const immediate = await recoverKilledSession({ sessionName: 'k', sessionInfo: killedSession('k'), killed: true, env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' }, runner, trackSession: () => {}, readLastSessionId: () => TOOL_SESSION, sleep: async ms => sleeps.push(ms) });
  assert.equal(immediate.resumed, true);
  const refused = await recoverKilledSession({ sessionName: 'r', sessionInfo: { ...killedSession('r'), stopRequestedByUser: true }, killed: true, env: {}, runner, trackSession: () => {}, readLastSessionId: () => TOOL_SESSION, sleep: async ms => sleeps.push(ms) });
  assert.equal(refused.resumed, false);
  assert.deepEqual(sleeps, []);
});

test('an in-process resume after a tool kill waits its random delay too, and says so', async () => {
  const events = [];
  const logs = [];
  const result = await resumeAfterToolKill({
    toolResult: { success: false, sessionId: TOOL_SESSION, errorInfo: { exitCode: 137 } },
    argv: { tool: 'claude' },
    env: {},
    runIteration: async () => (events.push('resume'), { success: true, sessionId: TOOL_SESSION }),
    log: async line => logs.push(line),
    random: () => 0.75,
    sleep: async ms => events.push(`sleep ${ms}`),
  });
  assert.equal(result.resumed, true);
  assert.deepEqual(events, ['sleep 75000', 'resume']);
  assert.ok(logs.some(line => /Waiting 75s before resuming/.test(line)));
});

test('a stop requested during the recovery delay cancels both launch paths', async () => {
  const info = killedSession('stopped-during-wait');
  info.isolationBackend = 'docker';
  const calls = [];
  const result = await recoverKilledSession({
    sessionName: info.sessionId,
    sessionInfo: info,
    killed: true,
    env: {},
    runner: {
      generateSessionId: () => 'new',
      resumeIsolatedSession: async () => calls.push('in-place'),
      executeWithIsolation: async () => (calls.push('fresh'), { success: true }),
    },
    trackSession: () => calls.push('track'),
    readLastSessionId: () => TOOL_SESSION,
    sleep: async () => {
      info.stopRequestedByUser = true;
    },
  });
  assert.equal(result.resumed, false);
  assert.equal(result.reason, 'stopped-by-user');
  assert.deepEqual(calls, []);
  assert.equal(info.killRecoveryAttempts, undefined);
});
