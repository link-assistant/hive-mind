#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2117: a non-zero runner exit must remain
 * visible, but a pull request that already merged must not be described as a
 * wholly failed work session.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2117
 */

import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { trackSession, monitorSessions, resetSessionMonitorForTests } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { initI18n } from '../src/i18n.lib.mjs';

const mergedPullRequest = {
  merged: true,
  mergedAt: '2026-07-30T06:38:12.000Z',
};

const formatted = formatSessionCompletionMessage({
  sessionName: 'issue-2117-format',
  sessionInfo: { isolationBackend: 'docker' },
  statusResult: {
    status: 'executed',
    exitCode: 1,
    startTime: '2026-07-30T06:14:58.000Z',
    endTime: '2026-07-30T06:38:56.000Z',
  },
  pullRequestUrl: 'https://github.com/link-foundation/use-m/pull/69',
  pullRequestState: mergedPullRequest,
});

assert(formatted.startsWith('⚠️ *Pull request merged, but the work session exited with code: 1*'), 'Merged PR plus non-zero exit is reported as a partial success');
assert(formatted.includes('The requested pull request was merged successfully.'), 'Message explicitly confirms the completed goal');
assert(formatted.includes('The runner also failed; its exit code is preserved for investigation.'), 'Message keeps the runner failure visible without inventing its exact timing');
assert(!formatted.includes('❌ *Work session failed'), 'Message does not contradict the merged pull request');

await initI18n('ru');
const localized = formatSessionCompletionMessage({
  sessionName: 'issue-2117-localized',
  sessionInfo: { locale: 'ru' },
  statusResult: { status: 'executed', exitCode: 1 },
  pullRequestState: mergedPullRequest,
});
assert(localized.includes('Пул-реквест объединён'), 'Split outcome headline respects the session locale');
assert(!localized.includes('telegram.work_session'), 'New localization keys never leak into the notification');

resetSessionMonitorForTests();
trackSession('issue-2117-monitor', {
  chatId: 2117,
  messageId: 2118,
  startTime: new Date('2026-07-30T06:14:58.000Z'),
  url: 'https://github.com/link-assistant/hive-mind/issues/2117',
  command: 'solve',
  isolationBackend: 'docker',
  sessionId: 'issue-2117-monitor',
  infoBlock: 'Issue: https://github.com/link-assistant/hive-mind/issues/2117',
  urlContext: { owner: 'link-assistant', repo: 'hive-mind', number: 2117, type: 'issue' },
});

const edits = [];
await monitorSessions(
  {
    telegram: {
      editMessageText: async (_chatId, _messageId, _inline, text) => {
        edits.push(text);
      },
    },
  },
  true,
  {
    statusProvider: async () => ({
      exists: true,
      status: 'executed',
      exitCode: 1,
      startTime: '2026-07-30T06:14:58.000Z',
      endTime: '2026-07-30T06:38:56.000Z',
    }),
    lookupLinkedPullRequest: async () => 'https://github.com/link-assistant/hive-mind/pull/2118',
    lookupPullRequestState: async url => {
      assert(url.endsWith('/pull/2118'), 'PR state lookup receives the resolved pull request URL');
      return mergedPullRequest;
    },
    dockerContainerSizeProvider: async () => null,
  }
);

assert(edits.length === 1, 'Monitor emits one completion update');
assert(edits[0].startsWith('⚠️ *Pull request merged, but the work session exited with code: 1*'), 'Monitor forwards merged PR evidence to the formatter');
assert(edits[0].includes('Pull request: https://github.com/link-assistant/hive-mind/pull/2118'), 'Monitor still includes the pull request URL');

resetSessionMonitorForTests();
printSummary();
if (getFailCount() > 0) process.exit(1);
