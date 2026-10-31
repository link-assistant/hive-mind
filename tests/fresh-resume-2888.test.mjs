/**
 * Issue #2888: a fresh kill-recovery container must resume a Codex thread only
 * when it can reach the thread's rollout, solve must keep rollouts where the
 * next container can see them, and a recovery solve refused for disk space
 * must be relaunched under the same attempt.
 * @hive-mind-test-suite default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexResumeRolloutCheck, findCodexRolloutFile, shareScopedCodexSessions } from '../src/codex-sessions.lib.mjs';
import { FRESH_RESUME_OUTCOMES, readResumeId, resolveFreshRecoveryCommand } from '../src/session-kill-resume.fresh-session.lib.mjs';
import { isDiskRefusedRecovery, MAX_DISK_DEFERRALS } from '../src/session-kill-resume.disk-retry.lib.mjs';
import { recoverKilledSession, runKillRecoveryForCompletion } from '../src/session-kill-resume.lib.mjs';
import { buildResumeCommand } from '../src/session-resume.lib.mjs';
import { executeCodexCommand } from '../src/codex.lib.mjs';

// The router#727 session from the issue.
const ISSUE_URL = 'https://github.com/link-assistant/router/issues/727';
const THREAD = '019f2a1b-0000-7000-8000-000000000727';
const SESSION = 'b5d0a0f1-6c0a-4c7e-9a52-2b3c4d5e6f70';
const ROLLOUT = `rollout-2026-10-01T10-00-00-${THREAD}.jsonl`;
const GIB = 1024 ** 3;

const tempHome = () => fs.mkdtemp(path.join(os.tmpdir(), 'hive-2888-'));
const info = (extra = {}) => ({ command: 'solve', commandAlias: 'codex', url: ISSUE_URL, args: [ISSUE_URL, '--tool', 'codex', '--verbose'], tool: 'codex', isolationBackend: 'docker', sessionId: SESSION, executionUuid: SESSION, ...extra });
const writeRollout = async dir => {
  const file = path.join(dir, '2026', '10', '01', ROLLOUT);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{"type":"session_meta"}\n');
  return file;
};

function freshHarness({ home, copy = null }) {
  const launches = [];
  const tracked = [];
  const events = [];
  const runner = {
    generateSessionId: () => 'fresh-session',
    executeWithIsolation: async (binary, args, options) => {
      launches.push({ binary, args, options });
      return { success: true, executionUuid: 'fresh-execution' };
    },
    ...(copy ? { copyFromDockerContainer: copy } : {}),
  };
  const recover = (sessionInfo = info()) =>
    recoverKilledSession({
      sessionName: SESSION,
      sessionInfo,
      runner,
      killed: true,
      env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
      readLastSessionId: async () => THREAD,
      trackSession: (name, data) => tracked.push({ name, data }),
      onLifecycle: async event => events.push(event),
      resolveFreshCommand: options => resolveFreshRecoveryCommand({ ...options, homeDir: home }),
    });
  return { recover, launches, tracked, events };
}

test('readResumeId reads the last --resume value', () => {
  assert.equal(readResumeId([ISSUE_URL, '--resume', 'a', '--resume=b']), 'b');
  assert.equal(readResumeId([ISSUE_URL, '-r', THREAD]), THREAD);
  assert.equal(readResumeId([ISSUE_URL]), null);
});

test('router#727: a fresh Codex recovery whose thread is unreachable starts a new session instead of failing', async () => {
  const home = await tempHome();
  const h = freshHarness({ home });
  const recovered = await h.recover();
  assert.equal(recovered.resumed, true);
  assert.equal(h.launches.length, 1);
  assert.equal(h.launches[0].binary, 'solve');
  assert.ok(!h.launches[0].args.includes('--resume'), `launched ${h.launches[0].args.join(' ')}`);
  assert.ok(!h.launches[0].args.includes(THREAD));
  assert.deepEqual(h.tracked[0].data.args, [ISSUE_URL, '--tool', 'codex', '--verbose']);
  assert.ok(h.events.some(event => /Codex thread .* new Codex session on the same branch/.test(event.reason || '')));
});

test('the rollout is copied out of the stopped container when it is only there', async () => {
  const home = await tempHome();
  const calls = [];
  const copy = async (container, source, destination) => {
    calls.push({ container, source });
    if (source !== '/home/box/.codex/hive-mind/repositories/link-assistant/router/sessions/.') return { success: false, error: 'legacy fixture has no shared directory' };
    await writeRollout(destination);
    return { success: true };
  };
  const h = freshHarness({ home, copy });
  await h.recover();
  assert.deepEqual(calls, [
    { container: SESSION, source: '/home/box/.codex/sessions/.' },
    { container: SESSION, source: '/home/box/.codex/archived_sessions/.' },
    { container: SESSION, source: '/home/box/.codex/hive-mind/repositories/link-assistant/router/sessions/.' },
  ]);
  assert.ok(await findCodexRolloutFile({ sessionsDir: path.join(home, '.codex', 'sessions'), threadId: THREAD }));
  assert.deepEqual(h.launches[0].args.slice(-2), ['--resume', THREAD]);
});

test('fresh task homes recover through the shared container sessions path', async () => {
  const home = await tempHome();
  const calls = [];
  const h = freshHarness({
    home,
    copy: async (container, source, destination) => {
      calls.push({ container, source });
      if (source !== '/home/box/.codex/sessions/.') return { success: false, error: 'task config has a unique disposable path' };
      await writeRollout(destination);
      return { success: true };
    },
  });
  await h.recover();
  assert.deepEqual(calls, [{ container: SESSION, source: '/home/box/.codex/sessions/.' }]);
  assert.ok(await findCodexRolloutFile({ sessionsDir: path.join(home, '.codex', 'sessions'), threadId: THREAD }));
  assert.deepEqual(h.launches[0].args.slice(-2), ['--resume', THREAD]);
});

test('a mounted rollout keeps --resume, and claude and other backends are left alone', async () => {
  const home = await tempHome();
  await writeRollout(path.join(home, '.codex', 'sessions'));
  const command = buildResumeCommand({ sessionInfo: info(), lastSessionId: THREAD });
  const kept = await resolveFreshRecoveryCommand({ sessionName: SESSION, sessionInfo: info(), command, runner: {}, homeDir: home });
  assert.equal(kept.outcome, FRESH_RESUME_OUTCOMES.KEPT);
  assert.equal(kept.command, command);
  for (const sessionInfo of [info({ tool: 'claude' }), info({ isolationBackend: 'screen' })]) {
    const result = await resolveFreshRecoveryCommand({ sessionName: SESSION, sessionInfo, command, runner: {}, homeDir: await tempHome() });
    assert.equal(result.outcome, FRESH_RESUME_OUTCOMES.NOT_CHECKED);
  }
  const dropped = await resolveFreshRecoveryCommand({ sessionName: SESSION, sessionInfo: info(), command, runner: {}, homeDir: await tempHome() });
  assert.equal(dropped.outcome, FRESH_RESUME_OUTCOMES.DROPPED);
  assert.equal(dropped.command.display, `solve ${ISSUE_URL} --tool codex --verbose`);
  assert.equal(dropped.command.chatDisplay, `/codex ${ISSUE_URL} --tool codex --verbose`);
});

test('R4: agent, gemini, qwen and opencode sessions are not mounted, so a new container drops their --resume', async () => {
  for (const tool of ['agent', 'gemini', 'qwen', 'opencode']) {
    const sessionInfo = info({ tool, commandAlias: 'solve', args: [ISSUE_URL, '--tool', tool] });
    const command = buildResumeCommand({ sessionInfo, lastSessionId: 'ses_727' });
    assert.equal(readResumeId(command.args), 'ses_727');
    const result = await resolveFreshRecoveryCommand({ sessionName: SESSION, sessionInfo, command, runner: {}, homeDir: await tempHome() });
    assert.equal(result.outcome, FRESH_RESUME_OUTCOMES.DROPPED, tool);
    assert.equal(readResumeId(result.command.args), null, tool);
    assert.equal(result.detail, `${tool} session ses_727 stayed in the killed container: task containers get no mount of ${tool}'s session store. Starting a new ${tool} session on the same branch instead.`);
    const screen = await resolveFreshRecoveryCommand({ sessionName: SESSION, sessionInfo: { ...sessionInfo, isolationBackend: 'screen' }, command, runner: {}, homeDir: await tempHome() });
    assert.equal(screen.outcome, FRESH_RESUME_OUTCOMES.NOT_CHECKED, `${tool} on the same host keeps its session`);
  }
  const routed = info({ tool: 'claude', args: [ISSUE_URL, '--tool', 'claude', '--use-router'] });
  const result = await resolveFreshRecoveryCommand({ sessionName: SESSION, sessionInfo: routed, command: buildResumeCommand({ sessionInfo: routed, lastSessionId: 'abc' }), runner: {}, homeDir: await tempHome() });
  assert.equal(result.outcome, FRESH_RESUME_OUTCOMES.DROPPED, 'a --use-router container gets no ~/.claude mounts');
});

test('the scoped CODEX_HOME writes rollouts into the shared (mounted) sessions directory', async () => {
  const root = await tempHome();
  const base = path.join(root, '.codex');
  const scoped = path.join(base, 'hive-mind', 'repositories', 'link-assistant', 'router');
  // An older run left a real sessions directory with one new and one conflicting rollout.
  await writeRollout(path.join(scoped, 'sessions'));
  await fs.mkdir(path.join(scoped, 'sessions', 'x'), { recursive: true });
  await fs.writeFile(path.join(scoped, 'sessions', 'x', 'same.jsonl'), 'scoped');
  await fs.mkdir(path.join(base, 'sessions', 'x'), { recursive: true });
  await fs.writeFile(path.join(base, 'sessions', 'x', 'same.jsonl'), 'shared');

  const shared = await shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped, now: () => 1 });
  assert.equal(shared.status, 'shared');
  assert.equal(shared.migrated, 1);
  assert.equal(shared.kept, 1);
  assert.ok((await fs.lstat(path.join(scoped, 'sessions'))).isSymbolicLink());
  assert.equal(await fs.readlink(path.join(scoped, 'sessions')), path.join('..', '..', '..', '..', 'sessions'));
  assert.ok(await findCodexRolloutFile({ sessionsDir: path.join(base, 'sessions'), threadId: THREAD }));
  assert.equal(await fs.readFile(path.join(base, 'sessions', 'x', 'same.jsonl'), 'utf8'), 'shared');
  assert.equal(await fs.readFile(path.join(scoped, 'sessions.pre-issue-2888-1', 'x', 'same.jsonl'), 'utf8'), 'scoped');
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped })).status, 'already-shared');

  // A brand-new container: a fresh scoped home sees the thread through the link.
  const fresh = path.join(root, 'fresh', '.codex');
  await fs.mkdir(path.join(fresh, 'sessions'), { recursive: true });
  await fs.cp(path.join(base, 'sessions'), path.join(fresh, 'sessions'), { recursive: true });
  const freshScoped = path.join(fresh, 'hive-mind', 'repositories', 'link-assistant', 'router');
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: fresh, codexHome: freshScoped })).status, 'shared');
  assert.ok(await findCodexRolloutFile({ sessionsDir: path.join(freshScoped, 'sessions'), threadId: THREAD }));
});

test('two solves of one repository linking sessions at once both report it shared', async () => {
  const root = await tempHome();
  const base = path.join(root, '.codex');
  const scoped = path.join(base, 'hive-mind', 'repositories', 'link-assistant', 'router');
  // Both runs see no link yet; the second one's symlink() then finds the first one's.
  const fsImpl = { ...fs, lstat: async (file, options) => (file === path.join(scoped, 'sessions') ? null : fs.lstat(file, options)) };
  const outcomes = await Promise.all([shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped, fsImpl }), shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped, fsImpl })]);
  assert.deepEqual(outcomes.map(outcome => outcome.status).sort(), ['already-shared', 'shared'], JSON.stringify(outcomes));
  // A different file in its place is still a failure.
  const other = path.join(root, 'other', '.codex');
  await fs.mkdir(path.join(other, 'hive-mind'), { recursive: true });
  await fs.writeFile(path.join(other, 'hive-mind', 'sessions'), 'not a link');
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: other, codexHome: path.join(other, 'hive-mind'), fsImpl })).status, 'failed');
});

test('solve resumes a Codex thread only when its rollout is in CODEX_HOME', async () => {
  const home = await tempHome();
  const logs = [];
  const log = async message => logs.push(message);
  const missing = createCodexResumeRolloutCheck();
  assert.equal(await missing({ threadId: THREAD, codexHome: home, log }), false);
  assert.ok(logs.some(line => line.includes('starting a new Codex session')));
  // Later attempts resume threads this run wrote itself.
  assert.equal(await missing({ threadId: 'thread-written-by-this-run', codexHome: home, log }), true);
  assert.equal(await missing({ threadId: null, codexHome: home, log }), false);

  await writeRollout(path.join(home, 'sessions'));
  assert.equal(await createCodexResumeRolloutCheck()({ threadId: THREAD, codexHome: home, log }), true);
});

// Runs executeCodexCommand() against a repository-scoped CODEX_HOME and returns the codex command.
async function runCodex({ resume, seedRollout }) {
  const root = await tempHome();
  const base = path.join(root, '.codex');
  const scoped = path.join(base, 'hive-mind', 'repositories', 'link-assistant', 'router');
  const bin = path.join(root, 'bin');
  await Promise.all([scoped, bin, path.join(root, 'workspace')].map(dir => fs.mkdir(dir, { recursive: true })));
  await shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped });
  if (seedRollout) await writeRollout(path.join(base, 'sessions'));
  await fs.writeFile(path.join(bin, 'codex'), '#!/bin/sh\necho "No MCP servers configured yet"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: base };
  const commands = [];
  const events = ['{"type":"thread.started","thread_id":"new-thread-2888"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"m","type":"agent_message","text":"ok"}}', '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'].join('\n');
  const fakeDollar =
    () =>
    (strings, ...values) => {
      commands.push(strings.reduce((out, part, index) => out + part + (index < values.length ? String(values[index]) : ''), ''));
      return {
        async *stream() {
          yield { type: 'stdout', data: Buffer.from(events) };
          yield { type: 'exit', code: 0 };
        },
      };
    };
  const previousPath = process.env.PATH;
  process.env.PATH = env.PATH;
  try {
    const result = await executeCodexCommand({
      tempDir: path.join(root, 'workspace'),
      branchName: 'issue-727-recovery',
      prompt: 'Continue.',
      systemPrompt: '',
      argv: { model: 'gpt-5.5', resume, verbose: false, playwrightMcp: false },
      log: async () => {},
      formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
      forkedRepo: null,
      feedbackLines: [],
      codexPath: 'codex',
      $: fakeDollar,
      owner: null,
      repo: null,
      prNumber: null,
      capabilityPreflight: { codexHome: scoped, baseCodexHome: base, codexBaseEnv: env },
      calculatePricing: async () => null,
      verifyCapabilityExecutionCatalog: async () => ({}),
    });
    assert.equal(result.success, true);
    assert.equal(commands.length, 1);
    return commands[0];
  } finally {
    process.env.PATH = previousPath;
  }
}

test('solve in a new container starts a new Codex session when the thread is unreachable, and resumes it when it is mounted', async () => {
  assert.doesNotMatch(await runCodex({ resume: THREAD, seedRollout: false }), /exec resume/u);
  assert.match(await runCodex({ resume: THREAD, seedRollout: true }), new RegExp(`exec resume "${THREAD}"`, 'u'));
});

test('a recovery solve refused for disk space (exit 75) is relaunched under the same attempt', async () => {
  const launches = [];
  const tracked = [];
  const events = [];
  const sessionInfo = { ...info({ isolationBackend: 'screen', args: [ISSUE_URL, '--tool', 'codex', '--min-disk-space', '2048', '--resume', THREAD] }), killRecoveryResumed: true, killRecoveryAttempts: 2, killRecoveryOfSession: 'killed-before' };
  assert.equal(isDiskRefusedRecovery({ sessionInfo, exitCode: 75 }), true);
  assert.equal(isDiskRefusedRecovery({ sessionInfo, exitCode: 1 }), false);
  assert.equal(isDiskRefusedRecovery({ sessionInfo: { ...sessionInfo, killRecoveryResumed: undefined }, exitCode: 75 }), false);

  const free = [1 * GIB, 3 * GIB];
  const waits = [];
  const { recovery } = await runKillRecoveryForCompletion({
    sessionName: SESSION,
    sessionInfo,
    exitCode: 75,
    killed: false,
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    runner: {
      generateSessionId: () => 'relaunched-session',
      executeWithIsolation: async (binary, args) => {
        launches.push({ binary, args });
        return { success: true, executionUuid: 'relaunched-execution' };
      },
    },
    // The refused run never reached the tool, so its log names no session.
    readLastSessionId: async () => null, // async, like readLastSessionIdFromLog (#3278)
    trackSession: (name, data) => tracked.push({ name, data }),
    onLifecycle: async event => events.push(event),
    diskRetry: { measureFree: async () => free.shift(), diskSleep: async ms => waits.push(ms) },
  });
  assert.equal(recovery.resumed, true);
  assert.equal(recovery.attempt, 2);
  assert.equal(waits.length, 1);
  assert.ok(events.some(event => event.phase === 'waiting' && /not enough disk space/.test(event.reason || '')));
  assert.deepEqual(launches[0].args.slice(-2), ['--resume', THREAD]);
  assert.equal(tracked[0].data.killRecoveryAttempts, 2);
  assert.equal(tracked[0].data.killRecoveryDiskDeferrals, 1);
  assert.equal(sessionInfo.killRecoveryAttempts, 2);
});

test('disk relaunches are bounded', async () => {
  const events = [];
  const sessionInfo = { ...info({ isolationBackend: 'screen' }), killRecoveryResumed: true, killRecoveryAttempts: 1, killRecoveryDiskDeferrals: MAX_DISK_DEFERRALS };
  const { recovery } = await runKillRecoveryForCompletion({ sessionName: SESSION, sessionInfo, exitCode: 75, runner: {}, onLifecycle: async event => events.push(event), diskRetry: { measureFree: async () => 100 * GIB } });
  assert.equal(recovery.resumed, false);
  assert.equal(recovery.reason, 'disk-deferrals-exhausted');
  assert.equal(events[0].phase, 'failed');
});
