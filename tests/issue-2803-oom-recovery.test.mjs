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
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeAfterToolKill, buildToolKillWarningComment, formatToolKillMemoryEvidence, TOOL_KILL_RESUME_FEEDBACK } from '../src/solve.tool-kill-resume.lib.mjs';
import { stopProcessesSurvivingSession } from '../src/session-survivors.lib.mjs';

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
