/**
 * Issue #2887: kill recovery of a `/codex` task ran the Telegram alias as the
 * program (`sh: 1: /codex: not found`, exit 127) and then reported the task as
 * `oom-killed`. This replays the router#728 incident of 2026-10-09 on the
 * current code: both recovery paths must execute `solve`, the alias stays in
 * chat text only, and a recovery container's own exit 127 is reported as such.
 * @hive-mind-test-suite default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildResumeCommand, formatResumeSection } from '../src/session-resume.lib.mjs';
import { recoverKilledSession, runKillRecoveryForCompletion } from '../src/session-kill-resume.lib.mjs';
import { detectFailedInPlaceStart } from '../src/session-kill-resume.start-failure.lib.mjs';
import { describeCommandStartFailure } from '../src/session-status.lib.mjs';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';
import { resolveOomKilledState } from '../src/session-monitor.oom.lib.mjs';

// The incident's values (issue #2887).
const ISSUE_URL = 'https://github.com/link-assistant/router/issues/728';
const SESSION = 'eec34a2b-aa97-4bf1-8879-b483ab13d784';
const EXECUTION = 'deb9c2e9-8234-43ef-9648-e102f5d34ebd';
const THREAD = '01a1200a-276e-76b2-9674-c219f0f54121';
const ARGS = [ISSUE_URL, '--think', 'xhigh', '--auto-merge', '--tool', 'codex', '--attach-logs', '--verbose', '--no-tool-check', '--disable-report-issue', '--language', 'en'];
const info = () => ({ command: 'solve', commandAlias: 'codex', url: ISSUE_URL, args: [...ARGS], tool: 'codex', isolationBackend: 'docker', sessionId: SESSION, executionUuid: EXECUTION });

function harness({ startup = { failed: false }, lastSessionId = THREAD } = {}) {
  const resumeCommands = [];
  const launches = [];
  const tracked = [];
  const events = [];
  const runner = {
    checkDockerContainerExists: async () => true,
    resumeIsolatedSession: async (identifier, options) => {
      resumeCommands.push({ identifier, command: options.command });
      return { success: true, uuid: EXECUTION, mode: RESUME_MODES.DOCKER_SNAPSHOT, sessionName: `${SESSION}-resume-1`, previousSessionName: SESSION, snapshotImage: `start-command-resume/${SESSION}:1` };
    },
    checkResumedDockerStartup: async () => startup,
    cleanupFailedResumeSnapshot: async () => ({ success: true }),
    generateSessionId: () => 'fresh-session',
    executeWithIsolation: async (binary, args, options) => {
      launches.push({ binary, args, options });
      return { success: true, executionUuid: 'fresh-execution' };
    },
  };
  const options = (sessionName, sessionInfo) => ({
    sessionName,
    sessionInfo,
    runner,
    killed: true,
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    // Async, like readLastSessionIdFromLog (#3278).
    readLastSessionId: async () => lastSessionId,
    trackSession: (name, data) => tracked.push({ name, data }),
    onLifecycle: async event => events.push(event),
    // Keep the fresh path independent of this host's ~/.codex (issue #2888).
    resolveFreshCommand: async ({ command }) => ({ command, outcome: 'not-checked', detail: null }),
  });
  const recover = () => recoverKilledSession(options(SESSION, info()));
  // The monitor's completion entry point, for a session that exited `exitCode`.
  const complete = (sessionName, sessionInfo, exitCode) => runKillRecoveryForCompletion({ ...options(sessionName, sessionInfo), exitCode });
  return { recover, complete, resumeCommands, launches, tracked, events };
}

test('the resume command of a /codex task executes solve; /codex appears only in the chat hint', () => {
  const command = buildResumeCommand({ sessionInfo: info(), lastSessionId: THREAD });
  assert.equal(command.binary, 'solve');
  assert.deepEqual(command.args, [...ARGS, '--resume', THREAD]);
  assert.ok(!command.display.startsWith('/'), command.display);
  assert.ok(!command.display.includes('/codex'));
  assert.equal(command.chatDisplay, `/codex ${[...ARGS, '--resume', THREAD].join(' ')}`);
  assert.match(formatResumeSection({ lastSessionId: THREAD, command }), /\/codex https:\/\/github\.com\/link-assistant\/router\/issues\/728 /);
});

test('in-place recovery of router#728 runs the verified workaround command, never /codex', { timeout: 10000 }, async () => {
  const h = harness();
  const recovered = await h.recover();
  assert.equal(recovered.resumed, true);
  assert.equal(recovered.inPlace, true);
  assert.equal(h.launches.length, 0);
  assert.equal(h.resumeCommands.length, 1);
  const { command } = h.resumeCommands[0];
  assert.match(command, /^exec 'solve' /);
  assert.ok(!command.includes('/codex'), command);
  assert.equal(h.tracked[0].name, `${SESSION}-resume-1`);

  // What `sh -c` runs inside the resumed container: the workaround of the issue.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alias-2887-'));
  try {
    await fs.writeFile(path.join(dir, 'solve'), '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
    await fs.writeFile(path.join(dir, 'codex'), '#!/bin/sh\necho "the alias was executed" >&2\nexit 99\n', { mode: 0o755 });
    const output = execFileSync('sh', ['-c', command], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), [...ARGS, '--resume', THREAD]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('when the resumed container still exits 127 at startup, the fresh launch also runs solve', { timeout: 10000 }, async () => {
  const h = harness({ startup: { failed: true, exitCode: 127, error: `Automatic recovery could not start: container ${SESSION}-resume-1 exited with code 127 after 1 seconds.` } });
  const recovered = await h.recover();
  assert.equal(recovered.resumed, true);
  assert.equal(recovered.inPlace, false);
  assert.equal(h.launches.length, 1);
  assert.equal(h.launches[0].binary, 'solve');
  assert.deepEqual(h.launches[0].args, [...ARGS, '--resume', THREAD]);
  assert.equal(h.tracked[0].name, 'fresh-session');
  assert.deepEqual(h.tracked[0].data.args, [...ARGS, '--resume', THREAD]);
  assert.equal(h.tracked[0].data.commandAlias, 'codex');
  assert.ok(h.events.some(event => event.phase === 'launching' && /exited with code 127/.test(event.reason || '')));
});

test("a recovery container's own exit 127 is reported as failed, not as the predecessor's oom-kill", async () => {
  const recovery = { ...info(), sessionId: `${SESSION}-resume-1`, killRecoveryResumed: true, killRecoveryOfSession: SESSION };
  // `$ --status` keeps the execution UUID, so its oomKilled flag can be the killed run's.
  const statusResult = { uuid: EXECUTION, status: 'executed', exitCode: 127, oomKilled: true };
  const fromStatus = await resolveOomKilledState(`${SESSION}-resume-1`, { ...recovery }, statusResult, { backendAlive: async () => false, exitFromLog: () => null });
  assert.equal(fromStatus.running, false);
  assert.equal(fromStatus.exitCode, 127);
  assert.equal(fromStatus.status, 'failed');

  const fromFooter = await resolveOomKilledState(`${SESSION}-resume-1`, { ...recovery, logPath: '/tmp/recovery.log' }, { ...statusResult, exitCode: 137 }, { backendAlive: async () => false, exitFromLog: () => ({ finished: true, exitCode: 127 }) });
  assert.equal(fromFooter.exitCode, 127);
  assert.equal(fromFooter.status, 'failed');
});

test('126 and 127 are described as a command that never started', () => {
  assert.deepEqual(describeCommandStartFailure(127), { exitCode: 127, reason: 'command-not-found', description: 'command not found' });
  assert.deepEqual(describeCommandStartFailure('126'), { exitCode: 126, reason: 'command-not-executable', description: 'command not executable' });
  for (const code of [0, 1, 75, 137, null]) assert.equal(describeCommandStartFailure(code), null);
});

test('the completion message of an exit 127 says the command was not found, in every locale', async () => {
  for (const locale of [null, 'en', 'ru', 'zh', 'hi']) {
    await initI18n({ language: locale || 'en' });
    const message = formatSessionCompletionMessage({ sessionName: SESSION, sessionInfo: { ...info(), locale }, exitCode: 127 });
    assert.match(message, /127/);
    assert.match(message, /command not found/, `${locale}: ${message.split('\n')[0]}`);
    assert.doesNotMatch(message, /oom|out of memory/i);
  }
  await initI18n({ language: 'en' });
  assert.doesNotMatch(formatSessionCompletionMessage({ sessionName: SESSION, sessionInfo: info(), exitCode: 1 }), /command not found/);
});

// What the in-place attempt of router#728 was tracked as.
const inPlaceRecovery = () => ({ ...info(), sessionId: `${SESSION}-resume-1`, args: [...ARGS, '--resume', THREAD], killRecoveryAttempts: 1, killRecoveryResumed: true, killRecoveryInPlace: true, killRecoveryOfSession: SESSION });

test('an in-place recovery that exits 127 at completion is relaunched fresh under the same attempt', { timeout: 10000 }, async () => {
  // The shared log yields no `Session ID:`; the attempt's own --resume is used.
  const h = harness({ lastSessionId: null });
  const recovery = inPlaceRecovery();
  assert.deepEqual(detectFailedInPlaceStart({ sessionInfo: recovery, exitCode: 127 }), describeCommandStartFailure(127));
  const { recovery: result } = await h.complete(`${SESSION}-resume-1`, recovery, 127);
  assert.equal(result.resumed, true);
  assert.equal(result.inPlace, false);
  assert.equal(result.attempt, 1);
  assert.equal(h.resumeCommands.length, 0, 'the snapshot path is not tried again');
  assert.equal(h.launches.length, 1);
  assert.equal(h.launches[0].binary, 'solve');
  assert.deepEqual(h.launches[0].args, [...ARGS, '--resume', THREAD]);
  assert.equal(h.tracked[0].name, 'fresh-session');
  assert.equal(h.tracked[0].data.killRecoveryAttempts, 1);
  assert.equal(h.tracked[0].data.killRecoveryInPlace, false);
  assert.equal(recovery.killRecoverySessionId, 'fresh-session');
  assert.ok(h.events.some(event => event.phase === 'launching' && /exited with code 127 \(command not found\)/.test(event.reason || '')));
});

test('a fresh recovery, an ordinary failure or a stopped session that exits 127 is not relaunched', () => {
  const fresh = { ...inPlaceRecovery(), killRecoveryInPlace: false };
  assert.equal(detectFailedInPlaceStart({ sessionInfo: fresh, exitCode: 127 }), null);
  assert.equal(detectFailedInPlaceStart({ sessionInfo: inPlaceRecovery(), exitCode: 1 }), null);
  assert.equal(detectFailedInPlaceStart({ sessionInfo: { ...inPlaceRecovery(), stopRequestedByUser: true }, exitCode: 127 }), null);
  assert.equal(detectFailedInPlaceStart({ sessionInfo: { ...inPlaceRecovery(), killRecoverySessionId: 'next' }, exitCode: 127 }), null);
  assert.equal(detectFailedInPlaceStart({ sessionInfo: info(), exitCode: 127 }), null);
});
