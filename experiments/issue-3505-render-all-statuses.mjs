#!/usr/bin/env node
// Issue #3505 (R5): render every Telegram status a /fix (or /solve) reply can
// show, in order, and check each one parses as legacy Markdown and keeps the
// Issue line right under Repository.
import { initI18n } from '../src/i18n.lib.mjs';
import { validateTelegramText } from '../src/telegram-markdown-validator.lib.mjs';
import { buildTelegramInfoBlock, buildSolveQueuedMessage } from '../src/telegram-ui-messages.lib.mjs';
import { formatStartingWorkSessionMessage, formatFailedLaunchMessage, formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { formatFixProgressMessage, addFixIssueToInfoBlock, formatLaunchedFixMessage } from '../src/fix-progress.lib.mjs';
import { formatRecoveryLifecycle } from '../src/session-recovery-lifecycle.lib.mjs';

await initI18n('en');
const locale = process.argv[2] || 'en';
const issueUrl = 'https://github.com/konard/voice-simulator/issues/7';
const base = buildTelegramInfoBlock({ requester: '[@drakonard](https://t.me/drakonard)', urlKind: 'url', url: 'https://github.com/konard/voice-simulator', optionsRaw: '--ci-cd --think high' });
const infoBlock = addFixIssueToInfoBlock(base, issueUrl, { locale });
const sessionInfo = { command: 'fix', locale, infoBlock, executionUuid: 'c3e5e3bd', isolationBackend: 'docker', startTime: new Date(Date.now() - 63000).toISOString() };
const now = new Date();
const shown = [
  ['queued', buildSolveQueuedMessage({ tool: 'claude', position: 2, infoBlock: base, locale })],
  ['starting (before launch)', formatStartingWorkSessionMessage({ isolationBackend: 'docker', infoBlock: base, locale })],
  ['starting (launched /fix)', formatLaunchedFixMessage({ sessionName: '02d3489a', sessionInfo: { ...sessionInfo, infoBlock: base }, locale })],
  ['issue-created', formatFixProgressMessage({ event: { phase: 'issue-created', issueUrl }, sessionName: '02d3489a', sessionInfo, locale })],
  ['waiting-for-ci', formatFixProgressMessage({ event: { phase: 'waiting-for-ci', branch: 'main', issueUrl, pending: [{ name: 'Checks and release', status: 'in_progress' }] }, sessionName: '02d3489a', sessionInfo, locale })],
  ['ci-finished', formatFixProgressMessage({ event: { phase: 'ci-finished', branch: 'main', issueUrl, outcome: 'success', waitedMs: 63000 }, sessionName: '02d3489a', sessionInfo, locale })],
  ['ci-finished (timeout)', formatFixProgressMessage({ event: { phase: 'ci-finished', branch: 'main', issueUrl, outcome: 'timeout', timeoutMs: 3600000 }, sessionName: '02d3489a', sessionInfo, locale })],
  ['solving', formatFixProgressMessage({ event: { phase: 'solving', issueUrl, ciOutcome: 'success' }, sessionName: '02d3489a', sessionInfo, locale })],
  ['failed launch', formatFailedLaunchMessage({ commandName: 'fix', sessionName: '02d3489a', isolationBackend: 'docker', infoBlock: base, error: 'spawn_failed: no_such_file', locale })],
  ['completion: success', formatSessionCompletionMessage({ sessionName: '02d3489a', sessionInfo, exitCode: 0, observedEndTime: now, locale })],
  ['completion: failed', formatSessionCompletionMessage({ sessionName: '02d3489a', sessionInfo, exitCode: 1, observedEndTime: now, locale })],
  ['completion: stopped by user', formatSessionCompletionMessage({ sessionName: '02d3489a', sessionInfo: { ...sessionInfo, stopRequestedByUser: true, stopRequestedBy: '@some_user' }, exitCode: 143, observedEndTime: now, locale })],
  ['completion: killed (OOM)', formatSessionCompletionMessage({ sessionName: '02d3489a', sessionInfo, exitCode: 137, observedEndTime: now, locale })],
  ['completion: recovering', formatSessionCompletionMessage({ sessionName: '02d3489a', sessionInfo, exitCode: 1, resumedAs: 'b1c2', observedEndTime: now, locale })],
  ['completion: unknown', formatSessionCompletionMessage({ sessionName: '02d3489a', sessionInfo, exitCode: null, launchUnobserved: true, observedEndTime: now, locale })],
  ['completion: with PR', formatSessionCompletionMessage({ sessionName: '02d3489a', sessionInfo, exitCode: 0, pullRequestUrl: 'https://github.com/konard/voice-simulator/pull/8', observedEndTime: now, locale })],
  ['recovery lifecycle', formatRecoveryLifecycle({ phase: 'waiting', attempt: 1, sessionName: '02d3489a', reason: 'exit_code 1 (in_progress)', delayMs: 30000 })],
];
let bad = 0;
for (const [label, text] of shown) {
  const result = validateTelegramText(text, 'Markdown');
  const lines = text.split('\n');
  const repo = lines.findIndex(line => /^(Repository|URL):/.test(line));
  const issue = lines.findIndex(line => line.includes('issues/7'));
  const issueOk = issue === -1 || issue === repo + 1;
  if (!result.valid || !issueOk) bad++;
  console.log(`--- ${label}: ${result.valid ? 'valid' : `INVALID ${result.description}`}${issueOk ? '' : ' ISSUE LINE MOVED'} ---\n${text}\n`);
}
console.log(bad === 0 ? 'ALL STATUSES OK' : `${bad} BAD`);
process.exit(bad === 0 ? 0 : 1);
