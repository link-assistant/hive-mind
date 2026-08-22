#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1851: process debugging must connect live/orphaned agent PIDs back to
 * the hive/start-command task session that launched them.
 */

import assert from 'node:assert/strict';

import { parseSessionStatusOutput } from '../src/isolation-runner.lib.mjs';
import { correlateProcesses, formatProcessDebugReport, parseStartCommandLogMetadata, redactProcessText } from '../src/process-debug.lib.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASSED ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAILED ${name}: ${error.message}`);
    failed++;
  }
}

const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/1851';
const sessionId = '578ec383-9ef3-43af-b8f5-f0f91f9366bf';
const workspace = '/tmp/gh-issue-solver-1780580701084';
const logPath = `/tmp/start-command/logs/isolation/screen/${sessionId}.log`;

test('parseSessionStatusOutput exposes processIds and sessionName from JSON', () => {
  const parsed = parseSessionStatusOutput(
    JSON.stringify({
      uuid: sessionId,
      pid: 88916,
      processIds: {
        wrapperPid: 88916,
        childPid: 88918,
      },
      status: 'executed',
      exitCode: 1,
      command: `solve ${issueUrl} --tool claude`,
      logPath,
      options: {
        isolated: 'screen',
        sessionName: sessionId,
      },
    })
  );

  assert.equal(parsed.uuid, sessionId);
  assert.equal(parsed.status, 'executed');
  assert.equal(parsed.processIds.wrapperPid, 88916);
  assert.equal(parsed.processIds.childPid, 88918);
  assert.equal(parsed.sessionName, sessionId);
});

test('parseSessionStatusOutput exposes processIds from links-notation text', () => {
  const parsed = parseSessionStatusOutput(`
${sessionId}
  uuid ${sessionId}
  pid 88916
  processIds
      wrapperPid 88916
      childPid 88918
  status executed
  command "solve ${issueUrl} --tool claude"
  logPath ${logPath}
  options
    isolated screen
    sessionName ${sessionId}
`);

  assert.equal(parsed.uuid, sessionId);
  assert.equal(parsed.processIds.wrapperPid, 88916);
  assert.equal(parsed.processIds.childPid, 88918);
  assert.equal(parsed.sessionName, sessionId);
});

test('parseStartCommandLogMetadata extracts task URL, workspace and tool', () => {
  const metadata = parseStartCommandLogMetadata({
    logPath,
    text: [`Command: solve ${issueUrl} --tool claude --attach-logs`, `Creating temporary directory: ${workspace}`, `Cloning into '${workspace}'...`, `(cd "${workspace}" && claude --output-format stream-json -p "Issue to solve: ${issueUrl}")`].join('\n'),
  });

  assert.equal(metadata.sessionId, sessionId);
  assert.equal(metadata.taskUrl, issueUrl);
  assert.equal(metadata.workspace, workspace);
  assert.equal(metadata.tool, 'claude');
});

test('correlateProcesses maps orphaned claude PID to terminal task session', () => {
  const sessions = [
    {
      sessionId,
      status: 'executed',
      command: `solve ${issueUrl} --tool claude`,
      taskUrl: issueUrl,
      workspace,
      logPath,
      processIds: { wrapperPid: 88916 },
      live: false,
    },
  ];
  const processes = [
    {
      pid: 94445,
      ppid: 1,
      pgid: 94445,
      sid: 94445,
      state: 'R',
      commandName: 'claude',
      cmdline: `claude --output-format stream-json --append-system-prompt "Issue to solve: ${issueUrl}"`,
      cwd: workspace,
      exe: '/home/box/.local/share/claude/versions/2.1.162',
      screenSessionName: null,
    },
  ];

  const report = correlateProcesses({ processes, sessions, currentPid: 1234 });
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].pid, 94445);
  assert.equal(report.items[0].agentKind, 'claude');
  assert.equal(report.items[0].sessionId, sessionId);
  assert.equal(report.items[0].taskUrl, issueUrl);
  assert.equal(report.items[0].orphaned, true);
  assert.equal(report.orphans.length, 1);
  assert.ok(report.items[0].matchReasons.includes('cwd-workspace'));
});

test('correlateProcesses does not mark executing screen-backed codex process as orphaned', () => {
  const sessions = [
    {
      sessionId: '8accdfd7-d36c-446e-8637-8574f215eda0',
      status: 'executing',
      command: `solve ${issueUrl} --tool codex`,
      taskUrl: issueUrl,
      workspace: '/tmp/gh-issue-solver-1780602790979',
      logPath: '/tmp/start-command/logs/isolation/screen/8accdfd7-d36c-446e-8637-8574f215eda0.log',
      processIds: { wrapperPid: 1758 },
      live: true,
      screenSessionName: '8accdfd7-d36c-446e-8637-8574f215eda0',
    },
  ];
  const processes = [
    {
      pid: 6536,
      ppid: 6517,
      pgid: 1759,
      sid: 1759,
      state: 'S',
      commandName: 'codex',
      cmdline: 'codex exec --model gpt-5.5',
      cwd: '/tmp/gh-issue-solver-1780602790979',
      exe: '/home/box/.bun/bin/codex',
      screenSessionName: '8accdfd7-d36c-446e-8637-8574f215eda0',
    },
  ];

  const report = correlateProcesses({ processes, sessions, currentPid: 1234 });
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].sessionId, '8accdfd7-d36c-446e-8637-8574f215eda0');
  assert.equal(report.items[0].orphaned, false);
  assert.equal(report.orphans.length, 0);
});

test('correlateProcesses includes targeted non-agent process without broad cwd noise', () => {
  const sessions = [
    {
      sessionId,
      status: 'executing',
      taskUrl: issueUrl,
      workspace,
      logPath,
      live: true,
    },
  ];
  const processes = [
    {
      pid: 2222,
      ppid: 100,
      state: 'S',
      commandName: 'chrome',
      cmdline: 'chrome --headless',
      cwd: workspace,
    },
  ];

  assert.equal(correlateProcesses({ processes, sessions, currentPid: 1234 }).items.length, 0);

  const report = correlateProcesses({ processes, sessions, currentPid: 1234, targetPids: [2222] });
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].pid, 2222);
  assert.equal(report.items[0].agentKind, null);
  assert.equal(report.items[0].sessionId, sessionId);
  assert.ok(report.items[0].matchReasons.includes('cwd-workspace'));
});

test('diagnostic report redacts tokens from command lines', () => {
  const telegramLikeToken = [['84905', '28355'].join(''), ':', ['AAEY', 'sflpqsH8', 'ocHWgFL2', 'U0GpFbWwFG9dJ1Y'].join('')].join('');
  const githubLikeToken = ['ghp_', '1234567890abcdef', '1234567890abcdef', '12345678'].join('');
  const raw = `node bot TELEGRAM_BOT_TOKEN: '${telegramLikeToken}' Authorization: Bearer ${githubLikeToken}`;
  const sanitized = redactProcessText(raw);
  assert.ok(!sanitized.includes(telegramLikeToken));
  assert.ok(!sanitized.includes(githubLikeToken));

  const report = formatProcessDebugReport({
    items: [
      {
        pid: 1,
        ppid: 0,
        agentKind: 'node',
        state: 'S',
        sessionId,
        sessionStatus: 'executed',
        taskUrl: issueUrl,
        orphaned: false,
        matchReasons: ['cmd-task-url'],
        cmdline: raw,
      },
    ],
    orphans: [],
  });
  assert.ok(report.includes(issueUrl));
  assert.ok(!report.includes(telegramLikeToken));
  assert.ok(!report.includes(githubLikeToken));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
