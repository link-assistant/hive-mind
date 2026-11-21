#!/usr/bin/env node

/**
 * Regression tests for issue #3505: the `/fix` Telegram reply must go
 * `🔄 Starting...` → `⏳ Waiting for CI/CD on ... branch to finish...` →
 * `⏳ Executing...`, keep its issue line in one place (under `Repository:`),
 * keep no permanent CI/CD outcome line, and always be valid Telegram Markdown.
 *
 * Reproduces the konard/voice-simulator#7 case: the waiting status listed
 * `` `Checks and release` (in_progress) `` and Telegram rejected the unpaired
 * `_`, so the reply fell back to plain text with a formatting warning.
 *
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { fixProgressLogLine, formatFixProgressMessage, formatLaunchedFixMessage, reportFixProgress } from '../src/fix-progress.lib.mjs';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { formatLivePullRequestMessage } from '../src/session-live-pr-link.lib.mjs';
import { validateTelegramText } from '../src/telegram-markdown-validator.lib.mjs';
import { formatExecutingWorkSessionMessage, formatSessionCompletionMessage, formatStartingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

await initI18n('en');

const SESSION = '02d3489a-72e4-4d94-ab68-dc1164bcf041';
const EXECUTION = 'c3e5e3bd-b103-4e3b-aa0b-d305033ae9e6';
const ISSUE_URL = 'https://github.com/konard/voice-simulator/issues/7';
const INFO_BLOCK = 'Requested by: [@drakonard](https://t.me/drakonard)\nRepository: https://github.com/konard/voice-simulator\n\n🛠 Options: --ci-cd --think high\n\n🔒 Solve overrides: --attach-logs --verbose --isolation docker';
const MARKERS = [
  { phase: 'issue-created', issueUrl: ISSUE_URL, branch: 'main' },
  { phase: 'waiting-for-ci', issueUrl: ISSUE_URL, branch: 'main', pending: [{ name: 'Checks and release', status: 'in_progress' }], waitedMs: 1000, timeoutMs: 3_600_000 },
  { phase: 'waiting-for-ci', issueUrl: ISSUE_URL, branch: 'main', pending: [{ name: 'Checks and release', status: 'queued' }], waitedMs: 61_000, timeoutMs: 3_600_000 },
  { phase: 'ci-finished', issueUrl: ISSUE_URL, branch: 'main', outcome: 'finished', waitedMs: 63_000, timeoutMs: 3_600_000 },
  { phase: 'solving', issueUrl: ISSUE_URL, branch: 'main', ciOutcome: 'finished', waitedMs: 63_000 },
];

const header = message => message.split('\n')[0];
const assertValidMarkdown = (message, label) => assert.deepEqual(validateTelegramText(message, 'Markdown'), { valid: true }, `${label} must be valid Telegram Markdown:\n${message}`);

function createMockBot() {
  const edits = [];
  return { edits, telegram: { editMessageText: async (chatId, messageId, inlineId, text) => edits.push(text) } };
}

/** Feed the markers one monitor tick at a time, like the session monitor does. */
async function replay(markers, sessionInfo, bot) {
  let log = '';
  for (const marker of markers) {
    log += `${fixProgressLogLine(marker)}\n`;
    await reportFixProgress({ bot, sessionName: SESSION, sessionInfo, readTail: async () => log });
  }
}

await test('voice-simulator#7: every /fix status is valid Telegram Markdown (no plain-text fallback)', async () => {
  const bot = createMockBot();
  const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, infoBlock: INFO_BLOCK, executionUuid: EXECUTION, isolationBackend: 'docker', logPath: '/fake/fix.log' };
  await replay(MARKERS, sessionInfo, bot);
  assert.ok(bot.edits.length > 0);
  for (const text of bot.edits) {
    assertValidMarkdown(text, header(text));
    assert.doesNotMatch(text, /Formatting error detected/);
  }
});

await test('the reply goes Starting → Waiting for CI/CD → Executing, one simple line each', async () => {
  const bot = createMockBot();
  const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, infoBlock: INFO_BLOCK, executionUuid: EXECUTION, isolationBackend: 'docker', logPath: '/fake/fix.log' };
  await replay(MARKERS, sessionInfo, bot);
  // The repeated CI poll changes nothing on screen, so it is not re-sent.
  assert.deepEqual(bot.edits.map(header), ['🔄 Starting...', '⏳ Waiting for CI/CD on `main` branch to finish...', '🔄 Starting...', '⏳ Executing...']);
  const waiting = bot.edits[1];
  assert.doesNotMatch(waiting, /Checks and release|in_progress|Running|Waited|⏱/, 'no pending run list and no timer');
  assert.equal(waiting.split('\n')[1], '', 'the waiting status is a single line');
});

await test('the issue line is added once, under Repository, and never moves', async () => {
  const bot = createMockBot();
  const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, infoBlock: INFO_BLOCK, executionUuid: EXECUTION, isolationBackend: 'docker', logPath: '/fake/fix.log' };
  await replay(MARKERS, sessionInfo, bot);
  const expectedBlock = INFO_BLOCK.replace('Repository: https://github.com/konard/voice-simulator\n', `Repository: https://github.com/konard/voice-simulator\nIssue: ${ISSUE_URL}\n`);
  assert.equal(sessionInfo.infoBlock, expectedBlock);
  for (const text of bot.edits) {
    assert.equal(text.split(ISSUE_URL).length - 1, 1, `the issue is linked exactly once in "${header(text)}"`);
    assert.ok(text.endsWith(`\n\n${expectedBlock}`), `the issue line sits under Repository in "${header(text)}"`);
    assert.ok(text.indexOf('Requested by:') < text.indexOf(`Issue: ${ISSUE_URL}`));
  }
  const completion = formatSessionCompletionMessage({ sessionName: SESSION, sessionInfo: { ...sessionInfo, startTime: new Date(Date.now() - 60_000) }, exitCode: 0, infoBlock: sessionInfo.infoBlock });
  assert.ok(completion.endsWith(`\n\n${expectedBlock}`), 'the completion message keeps the same info block');
});

await test('no CI/CD outcome line stays in the reply once the task runs or finishes', async () => {
  for (const ciOutcome of ['finished', 'timeout', 'idle', 'unknown', 'skipped']) {
    const bot = createMockBot();
    const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, infoBlock: INFO_BLOCK, executionUuid: EXECUTION, isolationBackend: 'docker', logPath: '/fake/fix.log' };
    const markers = [MARKERS[0], { phase: 'ci-finished', issueUrl: ISSUE_URL, branch: 'main', outcome: ciOutcome === 'skipped' ? 'idle' : ciOutcome, waitedMs: 63_000, timeoutMs: 1_800_000 }, { phase: 'solving', issueUrl: ISSUE_URL, branch: 'main', ciOutcome, waitedMs: 63_000 }];
    await replay(markers, sessionInfo, bot);
    const executing = bot.edits.at(-1);
    assert.equal(header(executing), '⏳ Executing...');
    assert.doesNotMatch(executing, /CI\/CD/, `no CI/CD line after a ${ciOutcome} wait`);
    assert.doesNotMatch(sessionInfo.infoBlock, /CI\/CD/);
    assert.doesNotMatch(formatLivePullRequestMessage({ sessionName: SESSION, sessionInfo }), /CI\/CD/);
  }
});

await test('executeAndUpdateMessage keeps a launched /fix on Starting (with the session ids) instead of Executing', async () => {
  const edits = [];
  const telegram = { editMessageText: async (chatId, messageId, inlineId, text) => edits.push(text) };
  const tracked = new Map();
  const run = buildExecuteAndUpdateMessage({
    resolveIsolation: async () => ({ backend: 'docker', runner: { generateSessionId: () => SESSION, executeWithIsolation: async () => ({ success: true, output: 'ok', executionUuid: EXECUTION }) } }),
    ISOLATION_BACKEND: 'docker',
    isolationRunner: {},
    VERBOSE: false,
    executeStartScreen: async () => ({ success: false }),
    trackSession: (name, info) => tracked.set(name, info),
    untrackSession: name => tracked.delete(name),
    AUTO_WATCH_MESSAGE: false,
    startAutoTerminalWatchForSession: async () => {},
    bot: { telegram },
    formatExecutingWorkSessionMessage,
    formatStartingWorkSessionMessage,
  });
  const ctx = { from: { id: 7 }, chat: { id: 42 }, message: {}, telegram };
  await run(ctx, { chat: { id: 42 }, message_id: 100 }, 'fix', ['https://github.com/konard/voice-simulator', '--ci-cd'], INFO_BLOCK, 'docker', 'claude');
  assert.deepEqual(edits.map(header), ['🔄 Starting...', '🔄 Starting...']);
  assert.match(edits.at(-1), new RegExp(`🆔 Execution: \`${EXECUTION}\``), 'the launched reply names the execution');
  assertValidMarkdown(edits.at(-1), 'launched /fix reply');

  // /solve still switches to Executing right after the launch.
  edits.length = 0;
  await run(ctx, { chat: { id: 42 }, message_id: 101 }, 'solve', ['https://github.com/konard/voice-simulator/issues/7'], INFO_BLOCK, 'docker', 'claude');
  assert.deepEqual(edits.map(header), ['🔄 Starting...', '⏳ Executing...']);
});

await test('a launch that returns after the monitor already showed a /fix phase does not roll it back', async () => {
  const sessionInfo = { command: 'fix', infoBlock: `${INFO_BLOCK}`, executionUuid: EXECUTION, isolationBackend: 'docker', fixProgress: { phase: 'waiting-for-ci', event: MARKERS[1] } };
  assert.equal(header(formatLaunchedFixMessage({ sessionName: SESSION, sessionInfo })), '⏳ Waiting for CI/CD on `main` branch to finish...');
  assert.equal(header(formatLaunchedFixMessage({ sessionName: SESSION, sessionInfo: { ...sessionInfo, fixProgress: undefined } })), '🔄 Starting...');
  assert.equal(header(formatLivePullRequestMessage({ sessionName: SESSION, sessionInfo: { ...sessionInfo, fixProgress: undefined } })), '🔄 Starting...', 'a PR link added before any marker does not claim Executing');
});

await test('adversarial branch, issue URL and workflow names never break Telegram Markdown', async () => {
  const nasty = ['feature_x', 'release*1', 'a`b', 'fix[1]', 'snake_case_branch', '_', '*', '`', '['];
  for (const value of nasty) {
    const issueUrl = `https://github.com/my_org/my_repo/issues/1?x=${value}`;
    const markers = [
      { phase: 'issue-created', issueUrl, branch: value },
      { phase: 'waiting-for-ci', issueUrl, branch: value, pending: [{ name: `wf_${value}`, status: 'in_progress' }], waitedMs: 0, timeoutMs: 60_000 },
      { phase: 'ci-finished', issueUrl, branch: value, outcome: 'timeout', waitedMs: 60_000, timeoutMs: 60_000 },
      { phase: 'solving', issueUrl, branch: value, ciOutcome: 'timeout', waitedMs: 60_000 },
    ];
    const bot = createMockBot();
    const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, infoBlock: INFO_BLOCK, executionUuid: EXECUTION, isolationBackend: 'docker', logPath: '/fake/fix.log' };
    await replay(markers, sessionInfo, bot);
    assert.equal(bot.edits.length, 4);
    for (const text of bot.edits) assertValidMarkdown(text, `branch ${JSON.stringify(value)}`);
    for (const event of markers) assertValidMarkdown(formatFixProgressMessage({ event, sessionName: SESSION, sessionInfo }), `${event.phase} with ${JSON.stringify(value)}`);
  }
});

await test('localized statuses keep the same order and stay valid Markdown', async () => {
  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    await initI18n(locale);
    const bot = createMockBot();
    const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, infoBlock: INFO_BLOCK, executionUuid: EXECUTION, isolationBackend: 'docker', logPath: '/fake/fix.log', locale };
    await replay(MARKERS, sessionInfo, bot);
    assert.equal(bot.edits.length, 4, locale);
    assert.equal(header(bot.edits[0]), header(formatStartingWorkSessionMessage({ locale })), `${locale}: starts with the Starting header`);
    assert.match(header(bot.edits[1]), /`main`/, `${locale}: the waiting status names the branch`);
    assert.equal(header(bot.edits[3]), header(formatExecutingWorkSessionMessage({ locale })), `${locale}: ends on the Executing header`);
    for (const text of bot.edits) assertValidMarkdown(text, `${locale} ${header(text)}`);
  }
  await initI18n('en');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
