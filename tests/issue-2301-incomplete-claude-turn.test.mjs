/**
 * @hive-mind-test-suite default
 * Regression for the links-notation#315 print-mode exit in issue #2301.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectClaudeStreamEventFacts, updateTerminalToolResult, assessClaudeTurnCompletion } from '../src/claude.stream-events.lib.mjs';
import { resolveOomKilledState, getOomEventObservedAt } from '../src/session-monitor.oom.lib.mjs';
import { buildKillCompletionSections, announceKillOnPullRequest } from '../src/session-monitor.kill-sections.lib.mjs';
import { resolveTelegramContainerResourceLimits } from '../src/telegram-container-resource-limits.lib.mjs';
import { getClaudeEnv } from '../src/config.lib.mjs';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { serializeSessionInfo } from '../src/session-store.lib.mjs';

const rejection = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const cancelledSubagent = {
  type: 'user',
  parent_tool_use_id: 'toolu_parent',
  tool_use_result: 'User rejected tool use',
  message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: rejection, tool_use_id: 'toolu_child' }] },
};
const completedResult = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  terminal_reason: 'completed',
  permission_denials: [],
  result: "I'm still waiting on the five port agents.",
  subagent_stats: { spawned: 5, completed: 0, failed: 0, killed: { parent: 0, user: 0, system: 5 } },
};

test('a post-result cancellation cannot veto a successful Claude result', () => {
  const earlierFailure = collectClaudeStreamEventFacts({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'javac failed' }] } });
  let terminal = updateTerminalToolResult(null, earlierFailure);
  assert.equal(terminal.failed, true, 'a real failure before the result remains visible');
  terminal = updateTerminalToolResult(terminal, collectClaudeStreamEventFacts(cancelledSubagent), { afterResult: true });
  assert.equal(terminal.error, 'javac failed', 'synthetic cancellation after the result leaves the pre-result verdict intact');
  terminal = updateTerminalToolResult(null, collectClaudeStreamEventFacts(cancelledSubagent), { afterResult: true });
  assert.equal(terminal.failed, false, 'a successful turn does not become a permission failure at shutdown');
});

test('unfinished background agents cause one same-session continuation', () => {
  const first = assessClaudeTurnCompletion({ resultEvent: completedResult, stoppedTaskCount: 2, recoveryAttempts: 0, sessionId: '85671f31-4459-422e-8fef-04ee03fd3aa0' });
  assert.equal(first.shouldResume, true);
  assert.equal(first.sessionId, '85671f31-4459-422e-8fef-04ee03fd3aa0');
  assert.equal(first.cancelledTasks, 5);
  const exhausted = assessClaudeTurnCompletion({ resultEvent: completedResult, stoppedTaskCount: 2, recoveryAttempts: 1, sessionId: first.sessionId });
  assert.equal(exhausted.shouldResume, false);
  assert.equal(exhausted.incomplete, true, 'a second incomplete turn must fail visibly');
  const clean = assessClaudeTurnCompletion({ resultEvent: { type: 'result', subtype: 'success', result: 'Done.' }, stoppedTaskCount: 0, recoveryAttempts: 0, sessionId: first.sessionId });
  assert.equal(clean.incomplete, false);
});

test('an OOM event in a child followed by exit 1 is a failed work session, not a recovered kill', async () => {
  const info = { isolationBackend: 'docker', sessionId: 'session', logPath: '/tmp/issue-2301-test.log', args: ['--on-session-kill', 'report'] };
  const state = await resolveOomKilledState('session', info, { status: 'executed', exitCode: 1, oomKilled: true, logPath: info.logPath }, { exitFromLog: () => ({ finished: true, exitCode: 1 }), backendAlive: async () => false });
  assert.equal(state.status, 'failed');
  assert.ok(getOomEventObservedAt(info), 'the child OOM event remains recorded after a non-signal failure');
  assert.equal(serializeSessionInfo(info).oomEventObservedAt, info.oomEventObservedAt, 'an observed OOM event survives a bot restart');
  const report = await buildKillCompletionSections({ sessionName: 'session', sessionInfo: info, statusResult: { oomKilled: true }, status: state.status, exitCode: state.exitCode, readFile: async () => '' });
  assert.equal(report.killed, false);
  assert.equal(report.recovered, false);
  assert.equal(report.oomEventOnly, true);
  assert.match(report.sections.join('\n'), /child process|container OOM event/i);
});

test('a PR notice never claims a new session when the OOM event was only survived', async () => {
  let postedBody = '';
  await announceKillOnPullRequest({
    pullRequestUrl: 'https://github.com/link-foundation/links-notation/pull/319',
    sessionName: '933a1ab3-1630-48a3-b35a-3087d7b2603c',
    sessionInfo: { args: [], logPath: null, killRecoveryResumed: true },
    diagnosis: { cause: 'out-of-memory', summary: 'A container OOM event occurred.', evidence: [] },
    exitCode: 1,
    recovered: true,
    resumed: false,
    runCommand: async (_command, args) => {
      postedBody = await fs.readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      return { code: 0, stdout: 'https://github.com/link-foundation/links-notation/pull/319#issuecomment-1', stderr: '' };
    },
  });
  assert.doesNotMatch(postedBody, /new working session was started/i);
  assert.match(postedBody, /survived|observed/i);
});

test('a recovery session surviving a later OOM does not claim another replacement', async () => {
  const report = await buildKillCompletionSections({
    sessionName: 'recovery-session',
    sessionInfo: { killRecoveryResumed: true, oomEventObservedAt: '2026-09-25T18:13:10.000Z', args: [], logPath: null },
    status: 'executed',
    exitCode: 0,
    readFile: async () => '',
  });
  assert.equal(report.recovered, true);
  assert.doesNotMatch(report.sections.join('\n'), /new working session was started/i);
});

test('Docker task memory is capped by default and remains configurable', () => {
  assert.equal(resolveTelegramContainerResourceLimits({}, 'docker').limits.memory, '25%');
  assert.equal(resolveTelegramContainerResourceLimits({ containerMemory: '4GiB' }, 'docker').limits.memory, '4GiB');
  assert.equal(resolveTelegramContainerResourceLimits({}, 'screen').limits.memory, null);
});

test('one-shot Claude execution can disable background tasks at the CLI', () => {
  assert.equal(getClaudeEnv({ disableBackgroundTasks: true }).CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, '1');
});

test('the monitor resumes an exit-1 session after a child OOM event and reports the actual new session', async () => {
  await initI18n('en');
  await preloadAllLocales();
  const sessionName = '933a1ab3-1630-48a3-b35a-3087d7b2603c';
  const toolSessionId = '85671f31-4459-422e-8fef-04ee03fd3aa0';
  const recoverySessionId = 'c33ee381-7113-4c12-ad33-82b3409209f0';
  const logPath = path.join(os.tmpdir(), `hive-mind-issue-2301-${process.pid}.log`);
  await fs.writeFile(logPath, `📌 Session ID: ${toolSessionId}\n📈 [RESOURCES] phase=before-agent memAvailableBytes=7000000000 memTotalBytes=12500000000\n`);
  const info = {
    chatId: 4242,
    messageId: 77,
    startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
    command: 'solve',
    tool: 'claude',
    isolationBackend: 'docker',
    sessionId: sessionName,
    logPath,
    locale: 'en',
    url: 'https://github.com/link-foundation/links-notation/issues/315',
    urlContext: { type: 'issue', owner: 'link-foundation', repo: 'links-notation', number: 315 },
    args: ['https://github.com/link-foundation/links-notation/issues/315', '--on-session-kill', 'resume'],
  };
  const edits = [];
  const launches = [];
  const comments = [];
  const bot = {
    telegram: {
      editMessageText: async (_chatId, _messageId, _inline, message) => {
        edits.push(message);
      },
      sendMessage: async () => ({ chat: { id: 4242 }, message_id: 1 }),
    },
  };
  resetSessionMonitorForTests();
  try {
    trackSession(sessionName, info, false);
    await monitorSessions(bot, false, {
      statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 1, oomKilled: true, isolation: 'docker', logPath }),
      exitFromLog: () => ({ finished: true, exitCode: 1, endTime: '2026-09-26T10:00:00.000Z' }),
      backendAlive: async () => false,
      dockerContainerSizeProvider: async () => null,
      readFile: async () => await fs.readFile(logPath, 'utf8'),
      lookupLinkedPullRequest: async () => 'https://github.com/link-foundation/links-notation/pull/319',
      env: {},
      isolationRunner: {
        generateSessionId: () => recoverySessionId,
        executeWithIsolation: async (command, args, opts) => {
          launches.push({ command, args, opts });
          return { success: true };
        },
      },
      runCommand: async (_command, args) => {
        comments.push(await fs.readFile(args[args.indexOf('--body-file') + 1], 'utf8'));
        return { code: 0, stdout: 'https://github.com/link-foundation/links-notation/pull/319#issuecomment-1', stderr: '' };
      },
    });
    assert.equal(launches.length, 1);
    assert.ok(launches[0].args.includes('--resume'));
    assert.ok(launches[0].args.includes(toolSessionId));
    assert.match(edits[0] || '', new RegExp(recoverySessionId));
    assert.match(comments[0] || '', /new working session was started/i);
    assert.match(comments[0] || '', new RegExp(recoverySessionId));
    assert.match(comments[0] || '', /container OOM event/i);
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(logPath, { force: true });
  }
});
