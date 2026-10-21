/**
 * @hive-mind-test-suite default
 * Recovery launch acceptance must not be mistaken for completed work (#2498).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, getActiveSessionCount } from '../src/session-monitor.lib.mjs';
import { readSessionExitFromLog } from '../src/isolation-runner.parsers.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { resumeAfterToolKill } from '../src/solve.tool-kill-resume.lib.mjs';

const pr = 'https://github.com/link-assistant/hive-mind/pull/2499';

function harness(logPath, status = 'executing', oomKilled = false) {
  const edits = [],
    comments = [];
  const info = { startTime: new Date(), chatId: 42, messageId: 77, command: 'solve', tool: 'claude', isolationBackend: 'docker', sessionId: 'replacement', logPath, url: pr, urlContext: { type: 'pull', owner: 'link-assistant', repo: 'hive-mind', number: 2499 }, locale: 'en', args: [pr, '--on-session-kill=report'], killRecoveryResumed: true, killRecoveryAttempts: 1, killRecoveryOfSession: 'original', rootSessionName: 'original' };
  const bot = { telegram: { editMessageText: async (_chat, _id, _inline, body) => edits.push(body), sendMessage: async (_chat, body) => (edits.push(body), { message_id: 88 }) } };
  const options = {
    statusProvider: async () => ({ exists: true, status, exitCode: status === 'executing' ? null : 1, oomKilled, logPath }),
    exitFromLog: readSessionExitFromLog,
    backendAlive: async () => true,
    dockerContainerSizeProvider: async () => null,
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async () => null,
    removeDockerContainer: async () => ({ success: true }),
    runCommand: async (_cmd, args) => {
      const editing = args.includes('--input');
      const payload = await fs.readFile(args[args.indexOf(editing ? '--input' : '--body-file') + 1], 'utf8');
      comments.push(editing ? JSON.parse(payload).body : payload);
      return { code: 0, stdout: `${pr}#issuecomment-123`, stderr: '' };
    },
    env: {},
  };
  return { info, bot, options, edits, comments };
}

for (const [status, oom] of [
  ['executing', false],
  ['executing', true],
  ['failed', false],
]) {
  test(`a resumed ${status} record with OOM=${oom} cannot reuse the original run's footer`, { timeout: 10000 }, async () => {
    await initI18n('en');
    resetSessionMonitorForTests();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-2498-'));
    const log = path.join(dir, 'execution.log');
    await fs.writeFile(log, '==========\nFinished: 2026-01-01 00:00:00.000\nExit Code: 137\n');
    const h = harness(log, status, oom);
    trackSession('replacement', h.info);
    try {
      await monitorSessions(h.bot, false, h.options);
      assert.equal(getActiveSessionCount(), 1, 'the replacement is still alive; the old footer belongs to the killed run');
      assert.ok(
        h.edits.every(body => !/failed|was killed|finished successfully/i.test(body)),
        h.edits.join('\n')
      );
    } finally {
      resetSessionMonitorForTests();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}

test('a launch notice says the recovery started and that a failed attempt is added later, without promising recovery or future progress', () => {
  const body = buildKillRecoveryNotice({ exitCode: 137, diagnosis: { cause: 'out-of-memory', evidence: [] }, resumed: true, recoverySessionId: 'replacement' });
  assert.doesNotMatch(body, /recovered from|Progress below continues/);
  assert.match(body, /restarted|launch.*accepted/i);
  // Issue #3435: the comment states the real state and is edited if the attempt fails.
  assert.match(body, /If this attempt fails too, its outcome is added to this comment/);
});

test('in-process recovery posts the eventual failure and logs the entire attempt', { timeout: 10000 }, async () => {
  const comments = [],
    logs = [];
  const result = await resumeAfterToolKill({
    toolResult: { success: false, exitCode: 137, sessionId: 'tool-session' },
    argv: { tool: 'claude' },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    $: () => {},
    owner: 'link-assistant',
    repo: 'hive-mind',
    prNumber: 2499,
    postComment: async ({ body }) => (comments.push(body), { ok: true, commentId: '5' }),
    log: async body => logs.push(body),
    runIteration: async () => ({ success: false, exitCode: 1, errorInfo: { message: 'authentication failed' } }),
  });
  assert.equal(result.toolResult.success, false);
  // Issue #3530: one kill comment, edited once when the attempt starts; the
  // attempt's outcome is in the log (and Telegram), not in further comments.
  assert.equal(comments.length, 2);
  assert.match(comments[0], /Auto recovery \(resume or restart as per configuration\) is pending/);
  assert.doesNotMatch(comments[1], /is pending|recovery-pending/);
  assert.match(logs.join('\n'), /Recovery attempt 1\/3 failed \(exit 1\): authentication failed/);
});

test('a same-log resume reads only the current footer and current stop evidence', async () => {
  const { scopeRecoveryFooter } = await import('../src/session-recovery-footer.lib.mjs');
  const { readLogTextBounded } = await import('../src/log-bounded-read.lib.mjs');
  const { detectDeliberateSolveStop } = await import('../src/session-kill-attribution.lib.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-scope-2498-'));
  const log = path.join(dir, 'execution.log');
  const old = 'User requested stop\n' + 'x'.repeat(4000) + '\n==========\nFinished: 2026-01-01 00:00:00.000\nExit Code: 137\n';
  const boundary = Buffer.byteLength(old);
  try {
    await fs.writeFile(log, old);
    const read = scopeRecoveryFooter(readSessionExitFromLog, { killRecoveryResumed: true, killRecoveryInPlace: true, killRecoveryLogStartBytes: boundary, startTime: new Date() });
    assert.equal((await read(log)).finished, false);
    await fs.appendFile(log, 'authentication failed\n==========\nFinished: 2026-01-01 00:00:01.000\nExit Code: 1\n');
    assert.equal((await read(log)).exitCode, 1, 'a byte-scoped footer is authoritative even across clock differences');
    const excerpt = await readLogTextBounded(log, { minByteOffset: boundary, maxBytes: 128 });
    assert.match(excerpt, /^authentication failed/);
    assert.doesNotMatch(excerpt, /137|User requested|omitted/);
    assert.equal(await detectDeliberateSolveStop(log, { minByteOffset: boundary }), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('recovery heartbeats distinguish real output from quiet runs, in Telegram only', async () => {
  const { reportRecoveryLifecycle, RECOVERY_HEARTBEAT_MS, recoveryLogLine } = await import('../src/session-recovery-lifecycle.lib.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-heartbeat-2498-'));
  const log = path.join(dir, 'execution.log');
  await fs.writeFile(log, '');
  const h = harness(log);
  h.info.killRecoveryLogStartBytes = 0;
  let now = Date.now();
  h.options.recoveryNow = () => now;
  const events = [];
  const report = extra => reportRecoveryLifecycle({ bot: h.bot, sessionName: 'replacement', sessionInfo: h.info, options: h.options, logEvent: (...args) => events.push(args), ...extra });
  try {
    assert.match(await report(), /No new execution output/);
    assert.match(h.edits[0], /No new execution output/);
    assert.equal(await report(), null, 'ordinary monitor ticks are throttled');
    assert.equal(h.edits.length, 1);
    // A restoration preserves the publication throttle.
    h.info.recoveryLifecycle = JSON.parse(JSON.stringify(h.info.recoveryLifecycle));
    await fs.appendFile(log, `${recoveryLogLine({ kind: 'tool', phase: 'running', attempt: 1 })}\n`);
    // Keep this a container attempt; malformed markers are not evidence.
    await fs.writeFile(log, '[HIVE-MIND RECOVERY] malformed heartbeat\n');
    now += RECOVERY_HEARTBEAT_MS;
    assert.match(await report(), /No new execution output/);
    await fs.appendFile(log, 'Writing the regression test\n');
    now += RECOVERY_HEARTBEAT_MS;
    const observed = await report();
    assert.match(observed, /Execution log output observed/);
    assert.match(observed, /does not establish commits or task progress/);
    assert.equal(h.edits.length, 3);
    const terminal = await report({ running: false, exitCode: 1, reason: 'authentication failed' });
    assert.match(terminal, /Recovery attempt failed/);
    assert.match(terminal, /authentication failed/);
    assert.equal(h.edits.length, 3, 'terminal Telegram text is included in the enclosing completion');
    assert.equal(events.length, 4);
    assert.equal(h.comments.length, 0, 'issue #3530: recovery phases are never posted to GitHub');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a tool outcome and its enclosing run outcome are both reported, even when their phase matches', async () => {
  const { reportRecoveryLifecycle, recoveryLogLine, RECOVERY_HEARTBEAT_MS } = await import('../src/session-recovery-lifecycle.lib.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-outcome-2498-'));
  const log = path.join(dir, 'execution.log');
  await fs.writeFile(log, recoveryLogLine({ kind: 'tool', phase: 'failed', attempt: 1, exitCode: 1, reason: 'authentication failed' }));
  const h = harness(log);
  h.info.killRecoveryResumed = false;
  let now = Date.now();
  h.options.recoveryNow = () => now;
  const texts = [];
  const report = async extra => {
    const text = await reportRecoveryLifecycle({ bot: h.bot, sessionName: 'original', sessionInfo: h.info, options: h.options, ...extra });
    if (text) texts.push(text);
    return text;
  };
  try {
    assert.match(await report(), /enclosing solve run is still under monitoring/);
    now += RECOVERY_HEARTBEAT_MS;
    await report();
    assert.equal(texts.length, 2, 'monitoring continues while the enclosing run is pending');
    await fs.appendFile(log, `\n${'Further enclosing-run output\n'.repeat(1600)}`);
    h.info.recoveryLifecycle = JSON.parse(JSON.stringify(h.info.recoveryLifecycle));
    now += RECOVERY_HEARTBEAT_MS;
    const restored = await report();
    assert.match(restored, /Recovery attempt failed/, 'a known tool result survives tail eviction and persisted-state restoration');
    assert.match(restored, /exited with code 1/);
    assert.match(restored, /authentication failed/);
    await report({ running: false, exitCode: 1 });
    assert.equal(texts.length, 4);
    assert.match(texts[3], /final outcome of the enclosing solve run/);
    assert.equal(h.edits.length, 3, 'active reports update the Telegram task reply');
    assert.equal(h.comments.length, 0, 'issue #3530: recovery phases are never posted to GitHub');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('in-process status edits use the tracked comment and remain recognized as automation', async () => {
  const { postTrackedComment, isToolGeneratedComment, RECOVERY_LIFECYCLE_MARKER } = await import('../src/tool-comments.lib.mjs');
  let payload, values;
  const result = await postTrackedComment({
    $:
      options =>
      async (_strings, ...args) => {
        payload = JSON.parse(options.stdin);
        values = args;
        return { code: 0, stdout: JSON.stringify({ id: 123 }) };
      },
    owner: 'link-assistant',
    repo: 'hive-mind',
    targetNumber: 2499,
    commentId: '123',
    body: `${RECOVERY_LIFECYCLE_MARKER}\nRecovery outcome pending`,
  });
  assert.equal(result.commentId, '123');
  assert.deepEqual(values, ['repos/link-assistant/hive-mind/issues/comments/123', 'PATCH']);
  assert.ok(isToolGeneratedComment(payload.body));
});

test('failed publications retry next tick instead of silencing recovery status', async () => {
  const { reportRecoveryLifecycle } = await import('../src/session-recovery-lifecycle.lib.mjs');
  const h = harness(null);
  let calls = 0;
  const bot = {
    telegram: {
      editMessageText: async () => {
        if (++calls === 1) throw new Error('temporary API failure');
        return true;
      },
    },
  };
  await reportRecoveryLifecycle({ bot, sessionName: 'replacement', sessionInfo: h.info, options: h.options });
  assert.equal(h.info.recoveryLifecycle.lastReportedMs, 0);
  await reportRecoveryLifecycle({ bot, sessionName: 'replacement', sessionInfo: h.info, options: h.options });
  assert.ok(calls >= 2);
  assert.ok(h.info.recoveryLifecycle.lastReportedMs > 0);
});

for (const throws of [false, true]) {
  test(`in-process heartbeat is bounded and drained when retry ${throws ? 'throws' : 'succeeds'}`, async () => {
    const logs = [],
      comments = [];
    let tick,
      cleared = false;
    const result = await resumeAfterToolKill({
      toolResult: { success: false, exitCode: 137 },
      argv: {},
      env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
      $: () => {},
      owner: 'link-assistant',
      repo: 'hive-mind',
      prNumber: 2499,
      log: async text => logs.push(text),
      postComment: async ({ body }) => (comments.push(body), { ok: true, commentId: '123' }),
      setIntervalFn: callback => ((tick = callback), 123),
      clearIntervalFn: id => {
        assert.equal(id, 123);
        cleared = true;
      },
      runIteration: async () => {
        tick();
        if (throws) throw new Error('resume launch rejected');
        return { success: true, exitCode: 0 };
      },
    });
    assert.equal(cleared, true);
    assert.equal(result.toolResult.success, !throws);
    // Issue #3530: posted once with the pending note, edited once when the attempt starts.
    assert.equal(comments.length, 2);
    assert.doesNotMatch(comments.at(-1), /is pending|recovery-pending/);
    assert.match(logs.join('\n'), /"phase":"waiting"/);
    assert.match(logs.join('\n'), /"phase":"launching"/);
    assert.match(logs.join('\n'), /"phase":"running"/);
    assert.match(logs.at(-1), throws ? /resume launch rejected/ : /finished successfully/);
  });
}

test('fresh recovery clears completion caches, preserves limits and cannot inherit a dead log', async () => {
  const { startKillRecoverySession } = await import('../src/session-kill-resume.lib.mjs');
  let tracked;
  const phases = [];
  const result = await startKillRecoverySession({
    sessionName: 'original',
    sessionInfo: { startTime: new Date(0), isolationBackend: 'screen', logPath: '/old/log', completionNotifiedAt: 'old', completionExitCode: 137, completionStatus: 'killed', lastToolSessionId: 'old-tool', args: [], containerResourceLimits: { requested: ['--memory=1g'] } },
    plan: { shouldResume: true, attempt: 1, maxAttempts: 3, command: { args: [pr], display: 'solve pr' } },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    onLifecycle: async event => phases.push(event.phase),
    runner: {
      generateSessionId: () => 'fresh',
      executeWithIsolation: async (_command, _args, options) => {
        assert.deepEqual(options.containerResourceLimits, ['--memory=1g']);
        return { success: true, executionUuid: 'fresh-uuid' };
      },
    },
    trackSession: (_id, info) => {
      tracked = info;
    },
  });
  assert.equal(result.resumed, true);
  assert.deepEqual(phases, ['waiting', 'launching', 'launching']);
  assert.equal(tracked.logPath, null);
  assert.equal(tracked.completionNotifiedAt, undefined);
  assert.equal(tracked.lastToolSessionId, undefined);
  assert.ok(tracked.startTime > new Date(0));
  assert.equal(tracked.rootStartTime.getTime(), 0);
});

test('a recovery whose terminal exit is unavailable is reported as unknown, never successful', async () => {
  const { reportRecoveryLifecycle } = await import('../src/session-recovery-lifecycle.lib.mjs');
  const { formatSessionCompletionMessage } = await import('../src/work-session-formatting.lib.mjs');
  const h = harness(null);
  const body = await reportRecoveryLifecycle({ sessionName: 'replacement', sessionInfo: h.info, options: h.options, running: false });
  assert.match(body, /outcome unknown/i);
  const completion = formatSessionCompletionMessage({ sessionName: 'replacement', sessionInfo: h.info, exitCode: null });
  assert.doesNotMatch(completion, /finished successfully/i);
  assert.match(completion, /unknown|could not be confirmed/i);
  await initI18n('en');
  const { setSessionLogger, setSessionStore } = await import('../src/session-monitor.lib.mjs');
  const completed = [],
    removed = [];
  resetSessionMonitorForTests();
  setSessionLogger({ event: (kind, record) => kind === 'session_completed' && completed.push(record) });
  setSessionStore({ persist: () => {}, remove: (_name, record) => removed.push(record) });
  h.options.statusProvider = async () => ({ exists: false });
  h.options.sessionRunning = async () => false;
  try {
    trackSession('replacement', h.info);
    await monitorSessions(h.bot, false, h.options);
    assert.equal(completed[0].exitCode, null, 'the completion audit must not manufacture exit 0');
    assert.equal(removed[0].exitCode, null, 'durable history preserves an unknown outcome');
    trackSession('replacement', h.info);
    await monitorSessions(h.bot, false, h.options);
    assert.equal(completed[1].exitCode, null, 'a restored completion latch preserves the unknown outcome');
  } finally {
    resetSessionMonitorForTests();
  }
});
