/**
 * @hive-mind-test-suite default
 * Issue #2498 (link-foundation/package-registry-manager#27): a work session that stopped because
 * the Claude OAuth session expired was announced on the pull request as
 * "⚠️ Container OOM event during a failed work session", and both the PR notice and Telegram
 * called the OOM event the "Cause" of the stop.
 *
 * What really happened (docs/case-studies/issue-2498): `rustc` was OOM-killed during a
 * `cargo test` build at 19:32, the session kept running, and at 19:40 Claude stopped with
 * "Authentication expired — re-login required". Docker's `State.OOMKilled` flag is sticky, so the
 * container still reported it when solve exited 1 at 19:41.
 *
 * Root causes covered here:
 *   1. the PR notice ignored the deliberate stop the monitor had already detected (#2408);
 *   2. the diagnostics section labelled the earlier OOM event "Cause" even after a deliberate stop;
 *   3. start-command 0.35.1 derives `memoryExhausted` / `exitReason: memory-exhaustion` from the
 *      sticky flag alone, for any exit code, and that was shown as separate evidence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { buildKillCompletionSections, announceKillOnPullRequest } from '../src/session-monitor.kill-sections.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { describeKillCause, formatKillDiagnosticsSection, UPSTREAM_CONTAINER_FLAG_REASON } from '../src/session-kill-diagnostics.lib.mjs';
import { findDeliberateSolveStop } from '../src/session-kill-attribution.lib.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'issue-2498', 'session-log-tail.txt');
const PR_URL = 'https://github.com/link-foundation/package-registry-manager/pull/27';
const pullContext = { type: 'pull', owner: 'link-foundation', repo: 'package-registry-manager', number: 27, normalized: PR_URL };
const SESSION = 'bebf2e57-01e1-4b47-af4a-06290e562446';
const OOM_OBSERVED_AT = '2026-10-04T19:32:49.507Z';
const AUTH_STOP = /Authentication expired — re-login required/;

/** The `$ --status` answer start-command 0.35.1 gave for this container. */
function incidentStatus(logPath) {
  return {
    exists: true,
    status: 'executed',
    exitCode: 1,
    oomKilled: true,
    memoryExhausted: true,
    memoryExhaustedReason: UPSTREAM_CONTAINER_FLAG_REASON,
    exitReason: 'memory-exhaustion (cgroup-oom-killer)',
    isolation: 'docker',
    logPath,
  };
}

function makeSessionInfo(logPath) {
  return {
    chatId: 4242,
    messageId: 77,
    startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
    command: 'solve',
    tool: 'claude',
    isolationBackend: 'docker',
    sessionId: SESSION,
    logPath,
    locale: 'en',
    url: PR_URL,
    urlContext: pullContext,
    args: [PR_URL, '--on-session-kill', 'resume'],
    oomEventObservedAt: OOM_OBSERVED_AT,
  };
}

async function readFixture() {
  return await fs.readFile(FIXTURE, 'utf8');
}

test('the real log tail is recognised as a deliberate stop (expired authentication)', async () => {
  const stop = findDeliberateSolveStop(await readFixture());
  assert.equal(stop?.reason, 'subscription-blocked');
  assert.match(stop.line, AUTH_STOP);
});

test('a flag-derived "memory exhaustion" from `$ --status` is not presented as separate evidence', () => {
  const diagnosis = describeKillCause({
    oomKilled: true,
    exitCode: 1,
    reportedMemoryExhausted: true,
    reportedMemoryExhaustedReason: UPSTREAM_CONTAINER_FLAG_REASON,
    reportedExitReason: 'memory-exhaustion (cgroup-oom-killer)',
  });
  const evidence = diagnosis.evidence.join('\n');
  assert.doesNotMatch(evidence, /reports memory exhaustion/, 'the sticky flag is one fact, not two');
  assert.match(evidence, /OOMKilled/);

  // Without `oomKilled` from our own status read, the flag is still recognised and kept once.
  const alone = describeKillCause({ exitCode: 1, reportedMemoryExhausted: true, reportedMemoryExhaustedReason: UPSTREAM_CONTAINER_FLAG_REASON });
  assert.equal(alone.evidence.filter(line => line.includes('OOMKilled')).length, 1);

  // A real detection by start-command (a log marker) is still passed through as evidence.
  const real = describeKillCause({ exitCode: 137, reportedMemoryExhausted: true, reportedMemoryExhaustedReason: 'JavaScript heap out of memory' });
  assert.match(real.evidence.join('\n'), /JavaScript heap out of memory/);
});

test('the Telegram sections do not call the earlier OOM event the cause of the stop', async () => {
  await initI18n('en');
  await preloadAllLocales();
  const sessionInfo = makeSessionInfo(FIXTURE);
  const report = await buildKillCompletionSections({ sessionName: SESSION, sessionInfo, statusResult: incidentStatus(FIXTURE), exitCode: 1, status: 'failed' });
  assert.equal(report.oomEventOnly, true);
  assert.equal(report.deliberateStop?.reason, 'subscription-blocked');
  const text = report.sections.join('\n');
  assert.match(text, /solve stopped on its own/);
  assert.match(text, AUTH_STOP);
  assert.match(text, /not the cause of this stop/);
  assert.doesNotMatch(text, /\*Cause:\*|Cause: /, 'the OOM event is labelled "Event", not "Cause"');
  assert.doesNotMatch(text, /reports memory exhaustion/);

  // Without a deliberate stop the OOM event is still the most likely cause and keeps its label.
  const plain = formatKillDiagnosticsSection(report.diagnosis, { locale: 'en' });
  assert.match(plain, /Cause/);
});

test('the pull-request notice leads with the real reason for the stop', () => {
  const deliberateStop = findDeliberateSolveStop('❌ ⚠️ SUBSCRIPTION/ACCESS UNAVAILABLE — CLAUDE stopped: Authentication expired — re-login required [authentication_failed]\nExit Code: 1\n');
  const notice = buildKillRecoveryNotice({ exitCode: 1, sessionName: SESSION, observedAt: OOM_OBSERVED_AT, policy: 'resume', oomEventOnly: true, deliberateStop, diagnosis: describeKillCause({ oomKilled: true, exitCode: 1 }) });
  assert.doesNotMatch(notice, /Container OOM event during a failed work session/);
  assert.match(notice, /stopped on its own/);
  assert.match(notice, /Why the work session stopped/);
  assert.match(notice, AUTH_STOP);
  assert.match(notice, /not the cause of this stop/);
  assert.match(notice, /OOM event observed at/);
  assert.ok(notice.indexOf('Authentication expired') < notice.indexOf('OOM event observed at'), 'the reason comes before the OOM details');

  // A failure with no deliberate stop keeps the previous wording.
  const plain = buildKillRecoveryNotice({ exitCode: 1, sessionName: SESSION, observedAt: OOM_OBSERVED_AT, oomEventOnly: true });
  assert.match(plain, /Container OOM event during a failed work session/);
});

test('the incident end to end: one corrected PR notice, no recovery, no OOM verdict', async () => {
  await initI18n('en');
  await preloadAllLocales();
  const logPath = path.join(os.tmpdir(), `hive-mind-issue-2498-${process.pid}.log`);
  await fs.writeFile(logPath, await readFixture());
  const edits = [];
  const comments = [];
  const launches = [];
  const bot = {
    telegram: {
      editMessageText: async (_chatId, messageId, _inline, message) => edits.push({ messageId, message }),
      sendMessage: async () => ({ chat: { id: 4242 }, message_id: 1 }),
    },
  };
  const options = {
    statusProvider: async () => incidentStatus(logPath),
    exitFromLog: () => null,
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    readFile: async file => await fs.readFile(file, 'utf8'),
    lookupLinkedPullRequest: async () => null,
    env: {},
    isolationRunner: {
      generateSessionId: () => 'recovery-1',
      executeWithIsolation: async (...args) => (launches.push(args), { success: true }),
    },
    runCommand: async (_command, args) => {
      comments.push(await fs.readFile(args[args.indexOf('--body-file') + 1], 'utf8'));
      return { code: 0, stdout: `${PR_URL}#issuecomment-1`, stderr: '' };
    },
  };
  resetSessionMonitorForTests();
  try {
    trackSession(SESSION, makeSessionInfo(logPath), false);
    await monitorSessions(bot, false, options);
    assert.equal(launches.length, 0, 'an expired login is not an OOM casualty to resume');
    assert.equal(comments.length, 1);
    assert.doesNotMatch(comments[0], /Container OOM event during a failed work session/);
    assert.match(comments[0], AUTH_STOP);
    assert.doesNotMatch(comments[0], /reports memory exhaustion/);
    const completion = edits.find(edit => edit.messageId === 77)?.message || '';
    assert.match(completion, /solve stopped on its own/);
    assert.doesNotMatch(completion, /\*Cause:\*/);
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(logPath, { force: true });
  }
});

test('announceKillOnPullRequest forwards the deliberate stop to the notice', async () => {
  const bodies = [];
  const deliberateStop = { reason: 'subscription-blocked', line: '❌ ⚠️ SUBSCRIPTION/ACCESS UNAVAILABLE — CLAUDE stopped: Authentication expired — re-login required' };
  const result = await announceKillOnPullRequest({
    pullRequestUrl: PR_URL,
    sessionName: SESSION,
    sessionInfo: { args: [PR_URL] },
    diagnosis: null,
    exitCode: 1,
    observedAt: OOM_OBSERVED_AT,
    oomEventOnly: true,
    deliberateStop,
    runCommand: async (_command, args) => (bodies.push(await fs.readFile(args[args.indexOf('--body-file') + 1], 'utf8')), { code: 0, stdout: `${PR_URL}#issuecomment-2`, stderr: '' }),
  });
  assert.equal(result.posted, true);
  assert.match(bodies[0], AUTH_STOP);
});
