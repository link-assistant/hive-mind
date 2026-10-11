#!/usr/bin/env node
/**
 * Regression tests for issue #2844.
 *
 * hive-cleanup could not map a Docker-isolation container to its session when
 * the session command named only a repository (`fix <repo> --ci-cd`,
 * `hive <repo> --all-issues`): no record was emitted, so the container lost its
 * repo, issue, session, status and workspace. The cleanup log was also written
 * next to the script (~/.bun/bin) and the docker heading printed a bare mode
 * name that read like an outcome.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2844
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildSessionTaskRecords, extractCreatedTaskRefsFromLog, extractRepoRefFromCommand, formatDockerIsolationContainerSummary, formatTaskSummary, planDockerIsolationCleanup } from '../src/cleanup.lib.mjs';
import { getActiveTasks, listSessionTasks, resolveSessionLogPath } from '../src/cleanup.os.lib.mjs';
import { parseSessionListOutput } from '../src/isolation-runner.parsers.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

// The two sessions from the issue report.
const FIX_SESSION = '05b20a82-1111-4111-8111-111111111111';
const HIVE_SESSION = '6c330d49-2222-4222-8222-222222222222';
const SOLVE_SESSION = '7d441e5a-3333-4333-8333-333333333333';

const fixSession = {
  uuid: FIX_SESSION,
  sessionName: FIX_SESSION,
  status: 'failed',
  exitCode: 1,
  isolation: 'docker',
  workingDirectory: '/home/box',
  startTime: '2026-10-08T10:00:00.000Z',
  command: "fix 'https://github.com/link-assistant/web-capture' --ci-cd --tool claude",
};
const hiveSession = {
  uuid: HIVE_SESSION,
  sessionName: HIVE_SESSION,
  status: 'failed',
  exitCode: 1,
  isolation: 'docker',
  workingDirectory: '/home/box',
  startTime: '2026-10-08T09:00:00.000Z',
  command: "hive 'https://github.com/link-assistant/router' --all-issues --once",
};
const solveSession = {
  uuid: SOLVE_SESSION,
  sessionName: SOLVE_SESSION,
  status: 'executed',
  exitCode: 0,
  isolation: 'docker',
  workingDirectory: '/tmp/gh-issue-solver-1',
  startTime: '2026-10-08T08:00:00.000Z',
  command: "solve 'https://github.com/link-assistant/hive-mind/issues/2844' --tool claude",
};

// Lines as fix.mjs and solve.auto-pr.lib.mjs print them (solve log lines carry a timestamp prefix).
const FIX_LOG = ['🔧 /fix CI/CD for link-assistant/web-capture', '📝 Creating issue...', '✅ Created issue: https://github.com/link-assistant/web-capture/issues/77', '🚀 Starting /solve: solve https://github.com/link-assistant/web-capture/issues/77 --tool claude', '[2026-10-08T10:01:00.000Z] [INFO]    Is PR URL: false', '[2026-10-08T10:02:00.000Z] [INFO] \u001b[32m✅ PR created:               #78\u001b[0m', '[2026-10-08T10:02:00.000Z] [INFO] 📍 PR URL:                   https://github.com/link-assistant/web-capture/pull/78'].join('\n');

function dockerContainers() {
  return [
    { name: FIX_SESSION, image: 'konard/hive-mind-dind:2.34.0', state: 'exited', status: 'Exited (1) 19 hours ago' },
    { name: HIVE_SESSION, image: 'konard/hive-mind-dind:2.34.0', state: 'exited', status: 'Exited (1) 19 hours ago' },
  ];
}

await test('extractRepoRefFromCommand parses a shell-quoted repo URL without issue/PR number', () => {
  assert.deepEqual(extractRepoRefFromCommand(fixSession.command), { owner: 'link-assistant', repo: 'web-capture' });
  assert.deepEqual(extractRepoRefFromCommand(hiveSession.command), { owner: 'link-assistant', repo: 'router' });
  assert.deepEqual(extractRepoRefFromCommand('hive https://github.com/link-assistant/hive-mind.git'), { owner: 'link-assistant', repo: 'hive-mind' });
  assert.deepEqual(extractRepoRefFromCommand('hive "https://github.com/link-assistant"'), { owner: 'link-assistant', repo: null });
  assert.equal(extractRepoRefFromCommand('task "do something"'), null);
  assert.equal(extractRepoRefFromCommand(null), null);
});

await test('extractCreatedTaskRefsFromLog recovers the issue and the linked PR a fix session created', () => {
  const refs = extractCreatedTaskRefsFromLog(FIX_LOG, { repoRef: { owner: 'link-assistant', repo: 'web-capture' } });
  assert.deepEqual(refs, [
    { owner: 'link-assistant', repo: 'web-capture', type: 'issue', number: 77, issueNumber: 77 },
    { owner: 'link-assistant', repo: 'web-capture', type: 'pull', number: 78, issueNumber: 77 },
  ]);
});

await test('extractCreatedTaskRefsFromLog resolves a bare "PR created: #N" against the command repo', () => {
  const refs = extractCreatedTaskRefsFromLog('✅ PR created:               #12\n', { repoRef: { owner: 'link-assistant', repo: 'router' } });
  assert.deepEqual(refs, [{ owner: 'link-assistant', repo: 'router', type: 'pull', number: 12, issueNumber: null }]);
  assert.deepEqual(extractCreatedTaskRefsFromLog('✅ PR created:               #12\n'), [], 'no repo known -> no guess');
  assert.deepEqual(extractCreatedTaskRefsFromLog(''), []);
});

await test('buildSessionTaskRecords always emits a record for a repo-only session', () => {
  const [record] = buildSessionTaskRecords(hiveSession, { terminal: true });
  assert.equal(record.owner, 'link-assistant');
  assert.equal(record.repo, 'router');
  assert.equal(record.type, null);
  assert.equal(record.number, null);
  assert.equal(record.sessionId, HIVE_SESSION);
  assert.equal(record.status, 'failed');
  assert.equal(record.exitCode, 1);
  assert.equal(record.workspace, '/home/box');
  assert.equal(record.terminal, true);

  const [bare] = buildSessionTaskRecords({ uuid: 'abc', status: 'executing', command: 'sleep 100' });
  assert.equal(bare.owner, null);
  assert.equal(bare.sessionId, 'abc');
  assert.equal(bare.status, 'executing');
});

await test('buildSessionTaskRecords prefers issue/PR URLs on the command line over the log', () => {
  const records = buildSessionTaskRecords(solveSession, { logText: FIX_LOG });
  assert.equal(records.length, 1);
  assert.equal(records[0].number, 2844);
  assert.equal(records[0].type, 'issue');
});

await test('formatTaskSummary renders repo-only and PR-with-issue records', () => {
  assert.equal(formatTaskSummary(buildSessionTaskRecords(hiveSession)[0]), `repo link-assistant/router, session ${HIVE_SESSION}, status failed, workspace /home/box`);
  assert.equal(formatTaskSummary({ owner: 'o', repo: 'r', type: 'pull', number: 78, issueNumber: 77 }), 'o/r PR #78 (issue #77)');
  assert.equal(formatTaskSummary({ owner: null, repo: null, type: null, number: null, sessionId: 's1', status: 'executing' }), 'session s1, status executing');
});

await test('planDockerIsolationCleanup maps repo-only sessions to their containers (issue report)', () => {
  const sessionTasks = [...buildSessionTaskRecords(fixSession, { terminal: true, logText: FIX_LOG }), ...buildSessionTaskRecords(hiveSession, { terminal: true })];
  const plan = planDockerIsolationCleanup({ containers: dockerContainers(), sessionTasks, mode: 'succeeded' });
  assert.equal(plan.remove.length, 0);
  assert.equal(plan.keep.length, 2);

  const fix = plan.keep.find(item => item.name === FIX_SESSION);
  assert.equal(fix.reason, 'failed-container-kept');
  assert.equal(fix.session.type, 'pull', 'most specific record describes the session');
  assert.equal(fix.session.number, 78);
  assert.equal(fix.session.status, 'failed');
  assert.equal(fix.session.workspace, '/home/box');
  const fixLine = formatDockerIsolationContainerSummary(fix);
  assert.match(fixLine, /link-assistant\/web-capture PR #78 \(issue #77\)/);
  assert.match(fixLine, /status failed/);
  assert.match(fixLine, /workspace \/home\/box/);

  const hive = plan.keep.find(item => item.name === HIVE_SESSION);
  const hiveLine = formatDockerIsolationContainerSummary(hive);
  assert.match(hiveLine, /repo link-assistant\/router/);
  assert.match(hiveLine, new RegExp(`session ${HIVE_SESSION}, status failed, workspace /home/box`));
});

await test('formatTaskSummary lists further PRs of the same hive session', () => {
  const log = ['📍 PR URL: https://github.com/link-assistant/router/pull/5', '📍 PR URL: https://github.com/link-assistant/router/pull/6'].join('\n');
  const plan = planDockerIsolationCleanup({ containers: dockerContainers().slice(1), sessionTasks: buildSessionTaskRecords(hiveSession, { terminal: true, logText: log }), mode: 'succeeded' });
  assert.match(formatDockerIsolationContainerSummary(plan.keep[0]), /link-assistant\/router PR #5, also PR #6/);
});

await test('parseSessionListOutput keeps logPath for log recovery', () => {
  const [record] = parseSessionListOutput(JSON.stringify([{ uuid: FIX_SESSION, logPath: '/tmp/start-command/logs/isolation/docker/x.log' }]));
  assert.equal(record.logPath, '/tmp/start-command/logs/isolation/docker/x.log');
});

await test('resolveSessionLogPath falls back to the start-command layout', () => {
  assert.equal(resolveSessionLogPath({ uuid: 'u', isolation: 'docker' }, '/logs'), '/logs/isolation/docker/u.log');
  assert.equal(resolveSessionLogPath({ uuid: 'u' }, '/logs'), '/logs/direct/u.log');
  assert.equal(resolveSessionLogPath({ uuid: 'u', logPath: '/x.log' }, '/logs'), '/x.log');
  assert.equal(resolveSessionLogPath({}, '/logs'), null);
});

await test('listSessionTasks emits one record per repo-only session and recovers created issue/PR from its log', async () => {
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-2844-'));
  try {
    fs.mkdirSync(path.join(logRoot, 'isolation', 'docker'), { recursive: true });
    fs.writeFileSync(path.join(logRoot, 'isolation', 'docker', `${FIX_SESSION}.log`), FIX_LOG);
    const tasks = await listSessionTasks({ listSessions: async () => [fixSession, hiveSession, solveSession], logRoot });
    const bySession = id => tasks.filter(task => task.sessionId === id);
    assert.deepEqual(
      bySession(FIX_SESSION).map(task => `${task.type}#${task.number}`),
      ['issue#77', 'pull#78']
    );
    assert.deepEqual(
      bySession(HIVE_SESSION).map(task => `${task.owner}/${task.repo}:${task.number}`),
      ['link-assistant/router:null']
    );
    assert.equal(bySession(SOLVE_SESSION)[0].number, 2844);
    assert.ok(tasks.every(task => task.terminal === true));
  } finally {
    fs.rmSync(logRoot, { recursive: true, force: true });
  }
});

await test('getActiveTasks keeps running repo-only sessions and skips sessions without a repo', async () => {
  const sessionTasks = [...buildSessionTaskRecords({ ...hiveSession, status: 'executing' }, { terminal: false }), ...buildSessionTaskRecords({ ...hiveSession, uuid: 'other', status: 'executing' }, { terminal: false }), ...buildSessionTaskRecords({ uuid: 'bare', status: 'executing', command: 'sleep 1' }, { terminal: false })];
  const active = (await getActiveTasks({ sessionTasks, resolveBranches: false })).filter(task => task.sessionId);
  assert.deepEqual(
    active.map(task => task.sessionId),
    [HIVE_SESSION, 'other']
  );
});

await test('cleanup log goes to HIVE_MIND_LOG_DIR, not the script directory; docker heading names the mode', () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-2844-logs-'));
  try {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cleanup.mjs'), '--dry-run', '--no-sessions', '--no-agent-snapshots', '--no-resolve-branches'], {
      cwd: logDir,
      env: { ...process.env, HIVE_MIND_LOG_DIR: logDir, TMPDIR: logDir },
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(result.status, 0, result.stderr);
    const logs = fs.readdirSync(logDir).filter(name => /^cleanup-.*\.log$/.test(name));
    assert.equal(logs.length, 1, `expected one cleanup log in ${logDir}`);
    assert.match(result.stdout, new RegExp(`Log file: ${logDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/cleanup-`));
    assert.doesNotMatch(result.stdout, /Docker isolation containers \((succeeded|all)\):/);
    if (/Docker isolation containers \(/.test(result.stdout)) assert.match(result.stdout, /Docker isolation containers \(mode: succeeded\):/);
    const scriptDirLogs = fs.readdirSync(path.join(repoRoot, 'src')).filter(name => /^cleanup-.*\.log$/.test(name));
    assert.deepEqual(scriptDirLogs, [], 'no cleanup log next to the script');
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
