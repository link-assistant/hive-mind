/**
 * @hive-mind-test-suite default
 * Issue #2888: the kill-recovery fresh-run fallback launched `solve … --resume <thread id>` in a new
 * Docker container that could not see the thread. Codex wrote its rollout to the repository-scoped
 * CODEX_HOME inside the killed container, so the run died with "no rollout found for thread id".
 *
 * A fresh recovery run must either have the tool session available or not ask for it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { describeScopedCodexSessions, findCodexRolloutFile, isCodexRolloutFileName, shareScopedCodexSessions } from '../src/codex-sessions.lib.mjs';
import { FRESH_RESUME_REASONS, findClaudeTranscriptFile, readResumeId, resolveFreshRecoveryCommand, restoreCodexRolloutFromContainer } from '../src/session-kill-resume.fresh-session.lib.mjs';
import { getDockerIsolationAuthMounts } from '../src/isolation-runner.lib.mjs';
import { startKillRecoverySession } from '../src/session-kill-resume.lib.mjs';

const THREAD = '019dfc4a-2d0f-7a91-b1a6-6e1b2c3d4e5f';
const ISSUE_URL = 'https://github.com/link-assistant/router/issues/727';
const ROLLOUT = `rollout-2026-10-09T13-02-11-${THREAD}.jsonl`;

const tempHome = async () => fs.mkdtemp(path.join(os.tmpdir(), 'issue-2888-'));
const writeFile = async (file, content = '{}\n') => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
};
const command = (args = [ISSUE_URL, '--tool', 'codex', '--resume', THREAD]) => ({ binary: 'solve', args, display: `solve ${args.join(' ')}` });
/** A runner whose mount table is the real one, rooted at a temporary home. */
const runnerFor = (homeDir, extra = {}) => ({
  DOCKER_CONTAINER_HOME: '/home/box',
  getDockerIsolationAuthMounts: options => getDockerIsolationAuthMounts({ ...options, homeDir }),
  ...extra,
});

test('rollout file names are matched by thread id only', () => {
  assert.equal(isCodexRolloutFileName(ROLLOUT, THREAD), true);
  assert.equal(isCodexRolloutFileName(`rollout-x-${THREAD}.json`, THREAD), false);
  assert.equal(isCodexRolloutFileName(`session-${THREAD}.jsonl`, THREAD), false);
  assert.equal(isCodexRolloutFileName(ROLLOUT, 'another-thread-id'), false);
});

test('findCodexRolloutFile walks YYYY/MM/DD and rejects ids that are not thread ids', async () => {
  const home = await tempHome();
  const sessions = path.join(home, 'sessions');
  const rollout = await writeFile(path.join(sessions, '2026', '10', '09', ROLLOUT));
  await writeFile(path.join(sessions, '2026', '10', '08', 'rollout-2026-10-08T00-00-00-0000aaaa-bbbb.jsonl'));
  assert.equal(await findCodexRolloutFile({ sessionsDir: sessions, threadId: THREAD }), rollout);
  assert.equal(await findCodexRolloutFile({ sessionsDir: sessions, threadId: '0000aaaa-cccc' }), null);
  assert.equal(await findCodexRolloutFile({ sessionsDir: sessions, threadId: '../../etc' }), null);
  assert.equal(await findCodexRolloutFile({ sessionsDir: path.join(home, 'missing'), threadId: THREAD }), null);
});

test('a new scoped CODEX_HOME writes its rollouts to the mounted ~/.codex/sessions', async () => {
  const home = await tempHome();
  const base = path.join(home, '.codex');
  const scoped = path.join(base, 'hive-mind', 'repositories', 'link-assistant', 'router');
  const outcome = await shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped });
  assert.equal(outcome.status, 'shared');
  assert.equal((await fs.lstat(path.join(scoped, 'sessions'))).isSymbolicLink(), true);
  assert.equal(path.isAbsolute(await fs.readlink(path.join(scoped, 'sessions'))), false, 'relative, so the link resolves in the container too');
  // What Codex does when it starts a thread under the scoped home:
  await writeFile(path.join(scoped, 'sessions', '2026', '10', '09', ROLLOUT));
  assert.ok(await findCodexRolloutFile({ sessionsDir: path.join(base, 'sessions'), threadId: THREAD }), 'the thread lands on the mounted volume');
  assert.match(describeScopedCodexSessions(outcome), /Codex rollouts: .*sessions → .*\.codex\/sessions/);

  const again = await shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped });
  assert.equal(again.status, 'already-shared');
});

test('rollouts already in an older scoped home are moved, never overwriting the shared ones', async () => {
  const home = await tempHome();
  const base = path.join(home, '.codex');
  const scoped = path.join(base, 'hive-mind', 'repositories', 'o', 'r');
  const older = await writeFile(path.join(scoped, 'sessions', '2026', '10', '01', ROLLOUT), 'scoped copy\n');
  await writeFile(path.join(scoped, 'sessions', '2026', '10', '01', 'rollout-a-11111111-2222.jsonl'), 'only here\n');
  await writeFile(path.join(base, 'sessions', '2026', '10', '01', 'rollout-a-11111111-2222.jsonl'), 'shared copy\n');
  const outcome = await shareScopedCodexSessions({ baseCodexHome: base, codexHome: scoped });
  assert.equal(outcome.status, 'shared');
  assert.equal(outcome.migrated, 1);
  assert.equal(outcome.kept, 1);
  assert.equal(await fs.readFile(path.join(base, 'sessions', '2026', '10', '01', ROLLOUT), 'utf8'), 'scoped copy\n');
  assert.equal(await fs.readFile(path.join(base, 'sessions', '2026', '10', '01', 'rollout-a-11111111-2222.jsonl'), 'utf8'), 'shared copy\n', 'never overwritten');
  const aside = (await fs.readdir(scoped)).find(name => name.startsWith('sessions.pre-issue-2888-'));
  assert.ok(aside, 'the conflicting copy is kept aside');
  assert.equal(await fs.readFile(path.join(scoped, aside, '2026', '10', '01', 'rollout-a-11111111-2222.jsonl'), 'utf8'), 'only here\n');
  assert.equal((await fs.lstat(path.join(scoped, 'sessions'))).isSymbolicLink(), true);
  assert.equal(await fs.readFile(older, 'utf8'), 'scoped copy\n', 'the old path now resolves through the link');
  assert.match(describeScopedCodexSessions(outcome), /moved 1 .*kept 1/);
});

test('sharing never throws; a failure is reported as a warning', async () => {
  const home = await tempHome();
  const fsImpl = { ...fs, symlink: async () => Promise.reject(new Error('EPERM: symlinks disabled')) };
  const outcome = await shareScopedCodexSessions({ baseCodexHome: path.join(home, '.codex'), codexHome: path.join(home, '.codex', 'hive-mind', 'repositories', 'o', 'r'), fsImpl });
  assert.equal(outcome.status, 'failed');
  assert.match(describeScopedCodexSessions(outcome), /⚠️ .*EPERM.*issue #2888/);
  assert.equal((await shareScopedCodexSessions({ baseCodexHome: '/x/.codex', codexHome: '/x/.codex' })).status, 'same-home');
  assert.equal((await shareScopedCodexSessions({})).status, 'failed');
});

test('readResumeId reads every --resume spelling', () => {
  assert.equal(readResumeId(['url', '--resume', 'abc']), 'abc');
  assert.equal(readResumeId(['url', '-r', 'abc']), 'abc');
  assert.equal(readResumeId(['url', '--resume=abc']), 'abc');
  assert.equal(readResumeId(['url']), null);
  assert.equal(readResumeId(null), null);
});

test('Claude transcripts are found by id in any project directory', async () => {
  const home = await tempHome();
  const projects = path.join(home, '.claude', 'projects');
  const transcript = await writeFile(path.join(projects, '-tmp-gh-issue-solver-1', `${THREAD}.jsonl`));
  assert.equal(await findClaudeTranscriptFile({ projectsDir: projects, sessionId: THREAD }), transcript);
  assert.equal(await findClaudeTranscriptFile({ projectsDir: projects, sessionId: '00000000-0000' }), null);
});

test('issue #2888 repro: a Codex thread that is nowhere a new container can see is not resumed', async () => {
  const home = await tempHome();
  await fs.mkdir(path.join(home, '.codex', 'sessions'), { recursive: true });
  const copies = [];
  const runner = runnerFor(home, {
    checkDockerContainerExists: async () => false, // the killed container was removed
    copyFromDockerContainer: async (...args) => copies.push(args) && { success: false, error: 'gone' },
  });
  const result = await resolveFreshRecoveryCommand({ sessionName: 's', sessionInfo: { tool: 'codex', isolationBackend: 'docker', url: ISSUE_URL, sessionId: 'killed' }, command: command(), runner, env: {}, homeDir: home });
  assert.equal(result.keptResume, false);
  assert.equal(result.reason, FRESH_RESUME_REASONS.MISSING);
  assert.equal(result.resumeId, THREAD);
  assert.deepEqual(result.command.args, [ISSUE_URL, '--tool', 'codex']);
  assert.equal(result.command.display, `solve ${ISSUE_URL} --tool codex`);
  assert.match(result.detail, /container gone/);
  assert.equal(copies.length, 0);
});

test('a Codex thread already on the mounted volume is resumed as is', async () => {
  const home = await tempHome();
  const rollout = await writeFile(path.join(home, '.codex', 'sessions', '2026', '10', '09', ROLLOUT));
  const result = await resolveFreshRecoveryCommand({ sessionInfo: { tool: 'codex', isolationBackend: 'docker', url: ISSUE_URL }, command: command(), runner: runnerFor(home), env: {}, homeDir: home });
  assert.equal(result.keptResume, true);
  assert.equal(result.reason, FRESH_RESUME_REASONS.AVAILABLE);
  assert.equal(result.detail, rollout);
  assert.deepEqual(result.command, command());
});

test('a Codex rollout left in the stopped container is copied out with docker cp and resumed', async () => {
  const home = await tempHome();
  await fs.mkdir(path.join(home, '.codex', 'sessions'), { recursive: true });
  const copies = [];
  const runner = runnerFor(home, {
    checkDockerContainerExists: async name => name === 'killed-container',
    copyFromDockerContainer: async (container, source, destination) => {
      copies.push({ container, source });
      await writeFile(path.join(destination, '2026', '10', '09', ROLLOUT), 'rollout\n');
      return { success: true };
    },
  });
  const result = await resolveFreshRecoveryCommand({ sessionName: 'other', sessionInfo: { tool: 'codex', isolationBackend: 'docker', url: ISSUE_URL, sessionId: 'killed-container' }, command: command(), runner, env: {}, homeDir: home });
  assert.equal(result.keptResume, true);
  assert.equal(result.reason, FRESH_RESUME_REASONS.RESTORED);
  assert.equal(result.restoredFrom, 'killed-container');
  assert.deepEqual(copies, [{ container: 'killed-container', source: '/home/box/.codex/hive-mind/repositories/link-assistant/router/sessions/.' }]);
  const restored = path.join(home, '.codex', 'sessions', '2026', '10', '09', ROLLOUT);
  assert.equal(result.detail, restored);
  assert.equal(await fs.readFile(restored, 'utf8'), 'rollout\n');
});

test('a restore that finds no rollout in the container drops --resume and cleans its staging dir', async () => {
  const home = await tempHome();
  const tmpDir = await tempHome();
  await fs.mkdir(path.join(home, '.codex', 'sessions'), { recursive: true });
  const runner = { checkDockerContainerExists: async () => true, copyFromDockerContainer: async () => ({ success: true }) };
  const restore = await restoreCodexRolloutFromContainer({ runner, containerName: 'c', sessionInfo: { url: ISSUE_URL }, threadId: THREAD, hostSessionsDir: path.join(home, '.codex', 'sessions'), tmpDir });
  assert.equal(restore.restored, null);
  assert.match(restore.error, /no rollout/);
  assert.deepEqual(await fs.readdir(tmpDir), []);
  const noRepo = await restoreCodexRolloutFromContainer({ runner, containerName: 'c', sessionInfo: { url: 'not a url' }, threadId: THREAD, hostSessionsDir: home, tmpDir });
  assert.match(noRepo.error, /no repository/);
});

test('Claude keeps --resume when the transcript is mounted and drops it when it is not', async () => {
  const home = await tempHome();
  const args = [ISSUE_URL, '--resume', THREAD];
  const info = { tool: 'claude', isolationBackend: 'docker' };
  await fs.mkdir(path.join(home, '.claude', 'projects'), { recursive: true });
  const missing = await resolveFreshRecoveryCommand({ sessionInfo: info, command: command(args), runner: runnerFor(home), env: {}, homeDir: home });
  assert.equal(missing.keptResume, false);
  assert.equal(missing.reason, FRESH_RESUME_REASONS.MISSING);
  await writeFile(path.join(home, '.claude', 'projects', '-tmp-gh-issue-solver-1', `${THREAD}.jsonl`));
  const available = await resolveFreshRecoveryCommand({ sessionInfo: info, command: command(args), runner: runnerFor(home), env: {}, homeDir: home });
  assert.equal(available.keptResume, true);
  assert.equal(available.reason, FRESH_RESUME_REASONS.AVAILABLE);
});

test('agent, opencode, gemini and qwen sessions stay in the container, so their fresh run does not resume', async () => {
  const home = await tempHome();
  for (const tool of ['agent', 'opencode', 'gemini', 'qwen']) {
    const result = await resolveFreshRecoveryCommand({ sessionInfo: { tool, isolationBackend: 'docker' }, command: command([ISSUE_URL, '--tool', tool, '--resume', THREAD]), runner: runnerFor(home), env: {}, homeDir: home });
    assert.equal(result.keptResume, false, tool);
    assert.equal(result.reason, FRESH_RESUME_REASONS.NOT_PERSISTED, tool);
    assert.deepEqual(result.command.args, [ISSUE_URL, '--tool', tool], tool);
  }
});

test('router tasks mount no vendor state, so their fresh run does not resume', async () => {
  const home = await tempHome();
  await writeFile(path.join(home, '.codex', 'sessions', '2026', '10', '09', ROLLOUT));
  const result = await resolveFreshRecoveryCommand({ sessionInfo: { tool: 'codex', isolationBackend: 'docker' }, command: command([ISSUE_URL, '--tool', 'codex', '--use-router', '--resume', THREAD]), runner: runnerFor(home), env: {}, homeDir: home });
  assert.equal(result.keptResume, false);
  assert.equal(result.reason, FRESH_RESUME_REASONS.NOT_MOUNTED);
  assert.deepEqual(result.command.args, [ISSUE_URL, '--tool', 'codex', '--use-router']);
});

test('host backends, runs without --resume and runners without a mount table keep the command', async () => {
  const home = await tempHome();
  const screen = await resolveFreshRecoveryCommand({ sessionInfo: { tool: 'codex', isolationBackend: 'screen' }, command: command(), runner: runnerFor(home), homeDir: home });
  assert.equal(screen.reason, FRESH_RESUME_REASONS.HOST_BACKEND);
  assert.equal(screen.keptResume, true);
  const plain = await resolveFreshRecoveryCommand({ sessionInfo: { tool: 'codex', isolationBackend: 'docker' }, command: command([ISSUE_URL]), runner: runnerFor(home), homeDir: home });
  assert.equal(plain.reason, FRESH_RESUME_REASONS.NO_RESUME);
  assert.equal(plain.keptResume, false);
  const unknown = await resolveFreshRecoveryCommand({ sessionInfo: { tool: 'codex', isolationBackend: 'docker' }, command: command(), runner: {}, homeDir: home });
  assert.equal(unknown.reason, FRESH_RESUME_REASONS.CHECK_UNAVAILABLE);
  assert.equal(unknown.keptResume, true);
  const broken = await resolveFreshRecoveryCommand({
    sessionInfo: { tool: 'codex', isolationBackend: 'docker' },
    command: command(),
    runner: {
      getDockerIsolationAuthMounts: () => {
        throw new Error('boom');
      },
    },
    homeDir: home,
  });
  assert.equal(broken.reason, FRESH_RESUME_REASONS.CHECK_FAILED);
  assert.equal(broken.keptResume, false);
});

test('the fresh kill-recovery run is launched and tracked with the resolved command', async () => {
  const home = await tempHome();
  await fs.mkdir(path.join(home, '.codex', 'sessions'), { recursive: true });
  let launchedArgs = null;
  let tracked = null;
  const result = await startKillRecoverySession({
    sessionName: 'killed',
    sessionInfo: { startTime: new Date(0), tool: 'codex', isolationBackend: 'docker', url: ISSUE_URL, sessionId: 'killed', args: [ISSUE_URL, '--tool', 'codex'] },
    plan: { shouldResume: true, attempt: 1, maxAttempts: 3, command: command() },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    runner: runnerFor(home, {
      generateSessionId: () => 'fresh',
      checkDockerContainerExists: async () => false,
      executeWithIsolation: async (_command, args) => {
        launchedArgs = args;
        return { success: true, executionUuid: 'fresh-uuid' };
      },
    }),
    resolveFreshCommand: options => resolveFreshRecoveryCommand({ ...options, homeDir: home }),
    trackSession: (_id, info) => {
      tracked = info;
    },
  });
  assert.equal(result.resumed, true);
  assert.deepEqual(launchedArgs, [ISSUE_URL, '--tool', 'codex']);
  assert.deepEqual(tracked.args, [ISSUE_URL, '--tool', 'codex']);
  assert.equal(result.display, `solve ${ISSUE_URL} --tool codex`);
  assert.deepEqual(result.freshResume, { keptResume: false, reason: FRESH_RESUME_REASONS.MISSING, resumeId: THREAD, restoredFrom: null });
});

test('host fresh runs drop --resume for tools whose sessions are bound to the old working directory', async () => {
  const home = await tempHome();
  const id = 'ses_edbd2ddecffe1QvOqwTwQEIPdq';
  for (const tool of ['gemini', 'qwen', 'opencode']) {
    const args = [ISSUE_URL, '--tool', tool, '--resume', id];
    const result = await resolveFreshRecoveryCommand({ sessionInfo: { tool, isolationBackend: 'screen' }, command: command(args), runner: runnerFor(home), homeDir: home });
    assert.equal(result.reason, FRESH_RESUME_REASONS.CWD_BOUND, tool);
    assert.equal(result.keptResume, false, tool);
    assert.deepEqual(result.command.args, [ISSUE_URL, '--tool', tool], tool);
    // The same directory again: the tool finds its session.
    for (const pinned of [['--working-directory', '/tmp/w'], ['-d', '/tmp/w'], ['--working-directory=/tmp/w']]) {
      const kept = await resolveFreshRecoveryCommand({ sessionInfo: { tool, isolationBackend: 'tmux' }, command: command([...args, ...pinned]), runner: runnerFor(home), homeDir: home });
      assert.equal(kept.reason, FRESH_RESUME_REASONS.HOST_BACKEND, `${tool} ${pinned.join(' ')}`);
      assert.equal(kept.keptResume, true);
    }
  }
  // claude, codex and agent find the session by id from any directory on the same host.
  for (const tool of ['claude', 'codex', 'agent']) {
    const result = await resolveFreshRecoveryCommand({ sessionInfo: { tool, isolationBackend: 'screen' }, command: command([ISSUE_URL, '--tool', tool, '--resume', id]), runner: runnerFor(home), homeDir: home });
    assert.equal(result.reason, FRESH_RESUME_REASONS.HOST_BACKEND, tool);
    assert.equal(result.keptResume, true, tool);
  }
});
