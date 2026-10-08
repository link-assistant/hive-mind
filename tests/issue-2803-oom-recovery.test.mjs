/**
 * @hive-mind-test-suite default
 * Issue #2803 (link-assistant/web-capture#178): the container OOM killer killed Claude (exit 137)
 * in the primary session of a `/fix` task. solve treated it as a critical error and exited 1, the
 * bot called the session "not resumable" because its command was `fix`, no OOM notice reached the
 * pull request, and the Telegram message blamed "a child process".
 *
 * Root causes covered here:
 *   1. only the watch/auto-merge iterations resumed a SIGKILLed tool in-process, not the primary session;
 *   2. the cgroup OOM counters solve had logged never reached the GitHub comment;
 *   3. processes the killed tool left running (`cargo test -j 2`) kept their memory;
 *   4. the bot could neither resume a `/fix` session (only `solve` takes `--resume`) nor find its
 *      pull request (a `/fix` URL names a repository), so recovery was refused as "not-resumable"
 *      and the notice was skipped with "no-pull-request".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeAfterToolKill, buildToolKillWarningComment, formatToolKillMemoryEvidence, TOOL_KILL_RESUME_FEEDBACK } from '../src/solve.tool-kill-resume.lib.mjs';
import { stopProcessesSurvivingSession } from '../src/session-survivors.lib.mjs';
import { formatFixHandoff, parseFixHandoff, readFixHandoffFromLog, resolveSolveSessionInfo } from '../src/fix-handoff.lib.mjs';
import { planKillRecovery, startKillRecoverySession } from '../src/session-kill-resume.lib.mjs';
import { resumeKilledSessionInPlace } from '../src/session-kill-resume.in-place.lib.mjs';
import { buildResumeCommand } from '../src/session-resume.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_SESSION = 'd9aa4383-bc63-4d77-a02d-27065219b12b';
// /sys/fs/cgroup values solve logged at 13:21:07 ("303 MB used of 2.9 GB limit, peak 2.9 GB; ... 3").
const INCIDENT_MEMORY = { version: 2, path: '/sys/fs/cgroup', limitBytes: 3135373312, currentBytes: 317718528, peakBytes: 3135373312, oomEvents: 13, oomKills: 3 };
const killed = { success: false, exitCode: 137, sessionId: CLAUDE_SESSION, errorInfo: { message: 'Claude command failed with exit code 137', exitCode: 137 } };

test('solve.mjs resumes a SIGKILLed primary session in-process, after stopping leftover processes', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'src/solve.mjs'), 'utf8');
  const primary = source.slice(source.indexOf('const runPrimaryTool'), source.indexOf('toolResult?.routerAuthViolation'));
  assert.ok(primary.length > 0, 'the primary session runs through runPrimaryTool');
  assert.match(primary, /toolResult = await runPrimaryTool\(\{ argv, feedbackLines \}\)/);
  assert.match(primary, /if \(isToolProcessKilled\(toolResult\)\)/);
  assert.match(primary, /resumeAfterToolKill\(\{[^}]*runIteration: runPrimaryTool/);
  assert.match(primary, /beforeAttempt: \(\) => stopProcessesSurvivingSession\(\{ tempDir, log \}\)/);
  // The classification (#2316) must run for every attempt, not only the first.
  assert.match(primary, /const runPrimaryTool = async \(\{ argv, feedbackLines \}\) => \{\s+const toolResult = await dispatchPrimaryTool\(\{ argv, feedbackLines \}\);\s+return await classifySessionResult\(/);
});

test('the primary-session resume continues the same Claude session and reports OOM evidence on the PR', async () => {
  const runs = [];
  const posted = [];
  const order = [];
  const result = await resumeAfterToolKill({
    toolResult: killed,
    argv: { tool: 'claude', autoMerge: true },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    runIteration: async params => (order.push('run'), runs.push(params), { success: true, sessionId: CLAUDE_SESSION }),
    $: () => {},
    owner: 'link-assistant',
    repo: 'web-capture',
    prNumber: 178,
    postComment: async params => posted.push(params.body),
    readMemory: () => INCIDENT_MEMORY,
    beforeAttempt: async ({ attempt }) => order.push(`prepare ${attempt}`),
  });
  assert.equal(result.toolResult.success, true);
  assert.equal(result.resumed, true);
  assert.deepEqual(order, ['prepare 1', 'run'], 'leftover processes are stopped before the resumed tool starts');
  assert.equal(runs[0].argv.resume, CLAUDE_SESSION);
  assert.deepEqual(runs[0].feedbackLines, [TOOL_KILL_RESUME_FEEDBACK]);
  assert.match(posted[0], /Working process killed \(SIGKILL, exit code 137\)/);
  assert.match(posted[0], /limit 2\.9 GB, peak 2\.9 GB; `memory\.events` oom=13, oom_kill=3\./);
  assert.match(posted[0], /OOM killer has killed 3 process\(es\) in this container, so an out-of-memory kill is the likely cause/);
});

test('the OOM evidence never claims a cause the cgroup does not show', () => {
  assert.equal(formatToolKillMemoryEvidence(null), null);
  assert.match(formatToolKillMemoryEvidence({ ...INCIDENT_MEMORY, oomEvents: 0, oomKills: 0 }), /No OOM kill is recorded in this container\.$/);
  assert.match(formatToolKillMemoryEvidence({ version: 2, limitBytes: null, peakBytes: null, oomEvents: null, oomKills: null }), /no limit of its own\. No OOM kill/);
  assert.doesNotMatch(buildToolKillWarningComment({}), /Container memory/);
  assert.match(buildToolKillWarningComment({ resuming: false, maxAttempts: 2, memory: INCIDENT_MEMORY }), /likely cause[\s\S]*budget \(2\) is spent/);
});

test('a failing beforeAttempt hook or memory probe does not stop the recovery', async () => {
  const logs = [];
  const result = await resumeAfterToolKill({
    toolResult: killed,
    argv: { tool: 'claude' },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    runIteration: async () => ({ success: true }),
    log: async line => logs.push(line),
    readMemory: () => {
      throw new Error('no /sys');
    },
    beforeAttempt: async () => {
      throw new Error('ps failed');
    },
  });
  assert.equal(result.toolResult.success, true);
  assert.ok(logs.some(line => /Preparing recovery attempt 1\/\d+ failed: ps failed/.test(line)));
});

test('stopProcessesSurvivingSession sends SIGTERM, then SIGKILL to what is still alive', async () => {
  const signals = [];
  const alive = new Set([107443, 107732]);
  const stopped = await stopProcessesSurvivingSession({
    tempDir: '/tmp/gh-issue-solver-1791461570905',
    find: async ({ dir, excludePids }) => {
      assert.equal(dir, '/tmp/gh-issue-solver-1791461570905');
      assert.ok(excludePids.includes(process.pid));
      return [
        { pid: 107443, command: '/bin/bash -c ...' },
        { pid: 107732, command: 'cargo test -j 2 --test integration transport::' },
      ];
    },
    kill: (pid, signal) => {
      if (!alive.has(pid)) throw new Error('ESRCH');
      signals.push(`${signal} ${pid}`);
      if (signal === 'SIGTERM' && pid === 107443) alive.delete(pid);
    },
    sleep: async () => {},
  });
  assert.equal(stopped.length, 2);
  assert.deepEqual(signals, ['SIGTERM 107443', 'SIGTERM 107732', '0 107732', 'SIGKILL 107732']);
  assert.deepEqual(await stopProcessesSurvivingSession({ tempDir: null }), []);
});

// Lines 69 and 3 of the incident's start-command log (session 05b20a82-...).
const ISSUE_URL = 'https://github.com/link-assistant/web-capture/issues/177';
const SOLVE_ARGS = [ISSUE_URL, '--development-log', '--deep-analysis', '--auto-merge', '--think', 'high', '--attach-logs', '--verbose', '--no-tool-check', '--disable-report-issue', '--language', 'en'];
const LEGACY_LOG = `$ fix https://github.com/link-assistant/web-capture --ci-cd\n🔎 Looking for failing CI runs...\n🚀 Starting /solve: ${['solve', ...SOLVE_ARGS].join(' ')}\n`;
const FIX_SESSION = { command: 'fix', url: 'https://github.com/link-assistant/web-capture', urlContext: { type: 'repo', owner: 'link-assistant', repo: 'web-capture' }, args: ['https://github.com/link-assistant/web-capture', '--ci-cd', '--on-session-kill', 'resume'], tool: 'claude', isolationBackend: 'docker', sessionId: '05b20a82-0000-4000-8000-000000002803', logPath: '/logs/05b20a82.log' };

test('the /fix handoff is read from both the marker and the legacy line of the log', () => {
  const legacy = parseFixHandoff(LEGACY_LOG);
  assert.equal(legacy.source, 'legacy');
  assert.equal(legacy.issueUrl, ISSUE_URL);
  assert.deepEqual(legacy.args, SOLVE_ARGS);
  assert.deepEqual(legacy.urlContext, { type: 'issue', owner: 'link-assistant', repo: 'web-capture', number: 177, normalized: ISSUE_URL });

  const withSpaces = [ISSUE_URL, '--prompt', 'two words'];
  const marker = parseFixHandoff(`${LEGACY_LOG}${formatFixHandoff(withSpaces)}\n`);
  assert.equal(marker.source, 'marker', 'the marker wins over the human-readable line');
  assert.deepEqual(marker.args, withSpaces, 'arguments with spaces survive the marker round-trip');

  assert.equal(parseFixHandoff('🧭 [FIX-HANDOFF] {"command":"solve","args":["https://github.com/a/b/pull/1"]}'), null, 'only an issue URL is a handoff');
  assert.equal(parseFixHandoff('🧭 [FIX-HANDOFF] {"command":"solve","ar'), null, 'a truncated marker is ignored');
  assert.equal(parseFixHandoff(''), null);
});

test('readFixHandoffFromLog reads the head of a real log and never throws', async () => {
  const dir = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'hive-mind-2803-'));
  try {
    const logPath = path.join(dir, 'session.log');
    await fs.writeFile(logPath, `${LEGACY_LOG}${'x'.repeat(4096)}\n`);
    assert.equal(readFixHandoffFromLog(logPath)?.issueUrl, ISSUE_URL);
    assert.equal(readFixHandoffFromLog(logPath, { maxBytes: 64 }), null, 'only the head is read');
    assert.equal(readFixHandoffFromLog(path.join(dir, 'missing.log')), null);
    assert.equal(readFixHandoffFromLog(null), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('fix.mjs prints the machine-readable handoff next to the human-readable line', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'src/fix.mjs'), 'utf8');
  assert.match(source, /console\.log\(formatFixHandoff\(solveArgs\)\)/);
});

test('a /fix session is resolved as the solve it handed off to; other commands are not', () => {
  const readHandoff = () => parseFixHandoff(LEGACY_LOG);
  const solve = resolveSolveSessionInfo(FIX_SESSION, { readHandoff });
  assert.equal(solve.command, 'solve');
  assert.equal(solve.url, ISSUE_URL);
  assert.equal(solve.urlContext.number, 177);
  assert.deepEqual(solve.fixHandoff, { issueUrl: ISSUE_URL, source: 'legacy' });
  assert.equal(resolveSolveSessionInfo(FIX_SESSION, { readHandoff: () => null }), null, 'a /fix that never reached solve stays not resumable');
  assert.equal(resolveSolveSessionInfo({ command: 'hive' }, { readHandoff }), null);
  const plain = { command: 'solve', url: ISSUE_URL };
  assert.equal(resolveSolveSessionInfo(plain), plain);
});

test('the bot plans to resume the incident /fix session as solve --resume <claude session>', () => {
  const plan = planKillRecovery({ sessionInfo: FIX_SESSION, logPath: FIX_SESSION.logPath, killed: true, env: {}, readLastSessionId: () => CLAUDE_SESSION, readHandoff: () => parseFixHandoff(LEGACY_LOG) });
  assert.equal(plan.shouldResume, true, `was refused: ${plan.reason}`);
  assert.equal(plan.command.command, 'solve');
  assert.deepEqual(plan.command.args, [...SOLVE_ARGS, '--resume', CLAUDE_SESSION]);
  assert.equal(plan.command.shell, `solve ${SOLVE_ARGS.join(' ')} --resume ${CLAUDE_SESSION}`);

  const before = planKillRecovery({ sessionInfo: FIX_SESSION, killed: true, env: {}, readLastSessionId: () => CLAUDE_SESSION, readHandoff: () => null });
  assert.equal(before.shouldResume, false);
  assert.equal(before.reason, 'not-resumable', 'the pre-fix behaviour for a /fix session without a handoff');
});

test('a fresh recovery launches solve, and tracks it as an issue-backed solve session', async () => {
  const plan = planKillRecovery({ sessionInfo: FIX_SESSION, killed: true, env: {}, readLastSessionId: () => CLAUDE_SESSION, readHandoff: () => parseFixHandoff(LEGACY_LOG) });
  const launches = [];
  const tracked = [];
  const runner = {
    generateSessionId: () => 'recovery-2803',
    executeWithIsolation: async (command, args, options) => (launches.push({ command, args, options }), { success: true, executionUuid: 'exec-2803', logPath: '/logs/recovery-2803.log' }),
  };
  const started = await startKillRecoverySession({ sessionName: FIX_SESSION.sessionId, sessionInfo: { ...FIX_SESSION, isolationBackend: 'screen' }, plan, runner, trackSession: (id, info) => tracked.push({ id, info }), env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' }, sleep: async () => {} });
  assert.equal(started.resumed, true, started.reason);
  assert.equal(launches[0].command, 'solve');
  assert.deepEqual(launches[0].args, [...SOLVE_ARGS, '--resume', CLAUDE_SESSION]);
  assert.equal(tracked[0].info.command, 'solve');
  assert.equal(tracked[0].info.url, ISSUE_URL);
  assert.equal(tracked[0].info.urlContext.type, 'issue');
  assert.equal(tracked[0].info.killRecoveryOfSession, FIX_SESSION.sessionId);
});

test('the same-container resume runs the real command, never the Telegram alias', async () => {
  const command = buildResumeCommand({ sessionInfo: { command: 'solve', commandAlias: 'codex', args: [ISSUE_URL, '--tool', 'codex'] }, lastSessionId: CLAUDE_SESSION });
  assert.match(command.display, /^\/codex /, 'the alias stays in what the user reads');
  assert.equal(command.shell, `solve ${ISSUE_URL} --tool codex --resume ${CLAUDE_SESSION}`);
  const calls = [];
  const runner = {
    checkDockerContainerExists: async () => true,
    resumeIsolatedSession: async (identifier, options) => (calls.push({ identifier, ...options }), { success: true, sessionId: 'same-container' }),
  };
  await resumeKilledSessionInPlace({ sessionName: 's', sessionInfo: { isolationBackend: 'docker', sessionId: 's', executionUuid: 'exec-1', args: [ISSUE_URL] }, plan: { command }, runner });
  assert.equal(calls[0].command, command.shell);
});
