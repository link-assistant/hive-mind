/**
 * @hive-mind-test-suite default
 * Issue #2301 (link-foundation/meta-language#196): a container OOM event hit a child process of a
 * session started on a pull request URL. The Telegram message said "Work session finished
 * successfully" while the work was being recovered, the pull request got no notice
 * ("no-pull-request": only issue-started sessions looked up a pull request), and a recovery session
 * would have replaced the `📊 Session:` id the thread started with.
 *
 * Now the message stays "in progress" until the recovery session actually ends, the notice goes to
 * the pull request the session was started on, and the thread keeps its original session id.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales, t } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { announceKillOnPullRequest } from '../src/session-monitor.kill-sections.lib.mjs';
import { serializeSessionInfo } from '../src/session-store.lib.mjs';

const PR_URL = 'https://github.com/link-foundation/meta-language/pull/196';
const pullContext = { type: 'pull', owner: 'link-foundation', repo: 'meta-language', number: 196, normalized: PR_URL };

test('the monitor keeps an OOM-recovered session in progress on its pull request and under its original id', async () => {
  await initI18n('en');
  await preloadAllLocales();
  const sessionName = '8ed87a4c-09ed-4ac7-ae94-e04a42af9f74';
  const toolSessionId = '85671f31-4459-422e-8fef-04ee03fd3aa0';
  const recoverySessionId = 'c33ee381-7113-4c12-ad33-82b3409209f0';
  const logPath = path.join(os.tmpdir(), `hive-mind-issue-2301-pr-${process.pid}.log`);
  await fs.writeFile(logPath, `📌 Session ID: ${toolSessionId}\n📈 [RESOURCES] phase=before-agent memAvailableBytes=9800000000 memTotalBytes=12500000000\n`);
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
    url: PR_URL,
    urlContext: pullContext,
    args: [PR_URL, '--on-session-kill', 'resume'],
  };
  const edits = [];
  const comments = [];
  const bot = {
    telegram: {
      editMessageText: async (_chatId, messageId, _inline, message) => edits.push({ messageId, message }),
      sendMessage: async () => ({ chat: { id: 4242 }, message_id: 1 }),
    },
  };
  const monitorOptions = statusProvider => ({
    statusProvider,
    exitFromLog: () => null,
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    readFile: async () => await fs.readFile(logPath, 'utf8'),
    lookupLinkedPullRequest: async () => null,
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    isolationRunner: { generateSessionId: () => recoverySessionId, executeWithIsolation: async () => ({ success: true }) },
    runCommand: async (_command, args) => {
      comments.push(await fs.readFile(args[args.indexOf('--body-file') + 1], 'utf8'));
      return { code: 0, stdout: `${PR_URL}#issuecomment-1`, stderr: '' };
    },
  });
  resetSessionMonitorForTests();
  try {
    trackSession(sessionName, info, false);
    await monitorSessions(
      bot,
      false,
      monitorOptions(async () => ({ exists: true, status: 'executed', exitCode: 1, oomKilled: true, isolation: 'docker', logPath }))
    );

    assert.equal(comments.length, 1, 'the pull request the session was started on gets the notice');
    assert.match(comments[0], /container OOM event/i);
    assert.match(comments[0], new RegExp(recoverySessionId));

    assert.equal(edits.length, 1);
    const first = edits[0].message;
    assert.doesNotMatch(first, /finished successfully/);
    assert.doesNotMatch(first, /Work session failed/);
    // Issue #2408: a recovery in progress is a warning, and says how many recoveries it took.
    assert.match(first, /^⚠️ \*Work session still in progress: recovering from exit code 1 \(automatic recoveries: 1\)\*/);
    assert.match(first, new RegExp(`📊 Session: \`${sessionName}\``));
    assert.match(first, new RegExp(`🔁 Recovery session: \`${recoverySessionId}\``));

    // The recovery session finishes: the same message now reports the real outcome, under the same id.
    await monitorSessions(
      bot,
      false,
      monitorOptions(async id => (id === recoverySessionId ? { exists: true, status: 'executed', exitCode: 0, isolation: 'docker', logPath } : { exists: false }))
    );
    assert.equal(edits.length, 2);
    assert.equal(edits[1].messageId, 77, 'the original reply is edited');
    assert.match(edits[1].message, /^⚠️ \*Work session finished successfully after automatic recovery \(automatic recoveries: 1\)\*/);
    assert.match(edits[1].message, /⏱️ Duration: 2m \d+s/, 'the duration covers the whole work, not only the recovery session');
    assert.match(edits[1].message, new RegExp(`📊 Session: \`${sessionName}\``));
    assert.match(edits[1].message, new RegExp(`🔁 Recovery session: \`${recoverySessionId}\``));
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(logPath, { force: true });
  }
});

test('an ordinary session completion message is unchanged', async () => {
  await initI18n('en');
  const message = formatSessionCompletionMessage({ sessionName: 'abc', sessionInfo: { startTime: new Date(0) }, exitCode: 0, observedEndTime: new Date(1000) });
  assert.match(message, /^✅ \*Work session finished successfully\*/);
  assert.match(message, /📊 Session: `abc`/);
  assert.doesNotMatch(message, /Recovery session/);
});

test('the in-progress headline and recovery label exist in every locale', async () => {
  await preloadAllLocales();
  for (const locale of ['en', 'ru', 'hi', 'zh']) {
    const recovering = t('telegram.work_session_recovering', { exitCode: 1 }, { locale });
    assert.ok(recovering && !recovering.includes('telegram.') && recovering.includes('1'), `${locale}: ${recovering}`);
    const label = t('telegram.session_recovery_label', {}, { locale });
    assert.ok(label && !label.includes('telegram.'), `${locale}: ${label}`);
  }
});

test('the killed-session notice falls back to the pull request the session was started on', async () => {
  const posted = [];
  const notice = await announceKillOnPullRequest({
    pullRequestUrl: null,
    sessionName: 's',
    sessionInfo: { urlContext: pullContext, args: [] },
    diagnosis: 'container OOM event',
    exitCode: 1,
    oomEventOnly: true,
    runCommand: async (_command, args) => {
      posted.push(args);
      return { code: 0, stdout: `${PR_URL}#issuecomment-2`, stderr: '' };
    },
  });
  assert.equal(notice.posted, true);
  assert.deepEqual(posted[0].slice(0, 3), ['pr', 'comment', PR_URL]);

  const issueNotice = await announceKillOnPullRequest({ pullRequestUrl: null, sessionName: 's', sessionInfo: { urlContext: { ...pullContext, type: 'issue' } }, runCommand: async () => assert.fail('an issue is not a pull request') });
  assert.equal(issueNotice.skipped, 'no-pull-request');
});

test('the root session id survives a bot restart', () => {
  const persisted = serializeSessionInfo({ rootSessionName: 'root-id', rootStartTime: new Date(0) });
  assert.equal(persisted.rootSessionName, 'root-id');
  assert.ok(persisted.rootStartTime);
});
