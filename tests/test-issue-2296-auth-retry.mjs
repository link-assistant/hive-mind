#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2296: a session that failed with
 *   API Error: 401 … "OAuth session expired and could not be refreshed"
 * was treated as a plain tool failure — no retry, the run ended and the work
 * was lost. The failure is usually a race for the single-use refresh token, so
 * it must be recovered by re-reading the credentials and resuming the same
 * session, and only reported after the resumed attempts failed too.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildAutomationStopComment } from '../src/automation-stop-reporting.lib.mjs';
import { AUTH_RETRY_DEFAULT_ATTEMPTS, classifyTransientAuthFailure, describeAuthRetryStop, findCredentialExpiryMs, reconcileCredentialCopy, resolveAuthRetryAttempts, resolveCredentialFile, runWithTransientAuthRetry, waitForCredentialRefresh } from '../src/auth-transient-retry.lib.mjs';
import { detectSubscriptionError } from '../src/subscription-error.lib.mjs';
import { formatToolExecutionFailure } from '../src/lib.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// The result the Claude adapter returned in the incident (trimmed).
const INCIDENT_MESSAGE = 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth session expired and could not be refreshed"}}';
const incidentResult = () => ({ success: false, sessionId: 'a1b2c3d4-session', errorInfo: { message: INCIDENT_MESSAGE }, subscriptionError: detectSubscriptionError({ code: 'authentication_failed', message: INCIDENT_MESSAGE, tool: 'claude' }) });
const noWait = async () => ({ file: null, ready: true, changed: true, waitedMs: 0, reason: 'test' });

console.log('\n--- Classification ---');
assertEqual(classifyTransientAuthFailure({ toolResult: incidentResult() }) !== null, true, 'the incident 401 is a transient auth failure');
assertEqual(classifyTransientAuthFailure({ toolResult: { success: false, errorInfo: { message: 'Failed to authenticate. API Error: 401' } } }) !== null, true, 'a bare 401 without subscription classification is one too');
assertEqual(classifyTransientAuthFailure({ error: Object.assign(new Error('Codex authentication failed - 401 Unauthorized.'), { isAuthError: true }) }) !== null, true, 'the error codex throws is one too');
assertEqual(classifyTransientAuthFailure({ toolResult: { success: false, errorInfo: { message: 'Your organization has disabled Claude subscription access' }, subscriptionError: { kind: 'org_subscription_disabled' } } }), null, 'a disabled organization is not retried');
assertEqual(classifyTransientAuthFailure({ toolResult: { success: false, errorInfo: { message: 'Credit balance is too low' }, subscriptionError: { kind: 'billing' } } }), null, 'a billing block is not retried');
assertEqual(classifyTransientAuthFailure({ toolResult: { success: false, limitReached: true, errorInfo: { message: '401' } } }), null, 'a usage limit is left to the usage-limit handling');
assertEqual(classifyTransientAuthFailure({ toolResult: { success: false, errorInfo: { message: 'Prompt is too long' } } }), null, 'an unrelated failure is not retried');
assertEqual(classifyTransientAuthFailure({ toolResult: { success: true } }), null, 'success is never retried');

console.log('\n--- --auth-retry-attempts ---');
assertEqual(AUTH_RETRY_DEFAULT_ATTEMPTS, 2, 'defaults to 2');
assertEqual(resolveAuthRetryAttempts({}), 2, 'unset → default');
assertEqual(resolveAuthRetryAttempts({ authRetryAttempts: 0 }), 0, '0 disables');
assertEqual(resolveAuthRetryAttempts({ 'auth-retry-attempts': 5 }), 5, 'kebab-case key is read');

console.log('\n--- A 401 followed by a successful resume ---');
{
  const calls = [];
  const result = await runWithTransientAuthRetry({
    tool: 'claude',
    argv: { tool: 'claude', model: 'opus' },
    waitForCredentials: noWait,
    run: async (argv, retry) => {
      calls.push({ resume: argv.resume || null, retry });
      return retry === 0 ? incidentResult() : { success: true, sessionId: 'a1b2c3d4-session' };
    },
  });
  assertEqual(
    calls,
    [
      { resume: null, retry: 0 },
      { resume: 'a1b2c3d4-session', retry: 1 },
    ],
    'the same session is resumed with --resume once'
  );
  assertEqual(result.success, true, 'the recovered result is returned');
  assertEqual(result.authRetry.recovered && result.authRetry.attempts, 1, 'the result records the recovery');
}

console.log('\n--- Retries exhausted ---');
{
  const calls = [];
  const result = await runWithTransientAuthRetry({
    tool: 'claude',
    argv: { tool: 'claude' },
    waitForCredentials: noWait,
    run: async argv => {
      calls.push(argv.resume || null);
      return incidentResult();
    },
  });
  assertEqual(calls, [null, 'a1b2c3d4-session', 'a1b2c3d4-session'], 'first run + 2 resumes by default');
  assertEqual(result.success, false, 'the failure is returned');
  assertEqual(result.errorInfo.message.startsWith('Authentication failed again after 2 automatic resume attempts: API Error: 401'), true, 'the error message says a retry was attempted');
  assertEqual(/Authentication failed again after 2 automatic resume attempts/.test(formatToolExecutionFailure({ tool: 'claude', toolResult: result })), true, 'so does the failure line every comment quotes');
  const stop = describeAuthRetryStop(result);
  assertEqual(stop.reason, 'auth_failure_after_retry', 'the automation stop uses the auth-specific reason');
  const comment = buildAutomationStopComment({ reason: stop.reason, mode: 'auto-restart-until-mergeable', message: result.errorInfo.message, details: stop.details });
  assertEqual(/resumed the same session with `--resume`/.test(comment) && /--resume a1b2c3d4-session/.test(comment) && /Attempt 2:/.test(comment), true, 'the "Automation stopped" comment explains the retry');
  assertEqual(describeAuthRetryStop({ success: false }).reason, 'tool_failure', 'other failures keep tool_failure');
}

console.log('\n--- Thrown auth errors (codex) and opt-out ---');
{
  const calls = [];
  let caught = null;
  try {
    await runWithTransientAuthRetry({
      tool: 'codex',
      argv: { tool: 'codex', authRetryAttempts: 1 },
      waitForCredentials: noWait,
      run: async argv => {
        calls.push(argv.resume || null);
        throw Object.assign(new Error('Codex authentication failed - 401 Unauthorized.'), { isAuthError: true, sessionId: 'codex-thread-1' });
      },
    });
  } catch (error) {
    caught = error;
  }
  assertEqual(calls, [null, 'codex-thread-1'], 'the codex thread is resumed');
  assertEqual(caught?.isAuthError && caught.authRetry.attempts === 1 && caught.message.startsWith('Authentication failed again after 1 automatic resume attempt:'), true, 'the rethrown error says a retry was attempted');

  let runs = 0;
  const disabled = await runWithTransientAuthRetry({ tool: 'claude', argv: { authRetryAttempts: 0 }, waitForCredentials: noWait, run: async () => (runs++, incidentResult()) });
  assertEqual([runs, disabled.errorInfo.message], [1, INCIDENT_MESSAGE], '--auth-retry-attempts 0 disables the recovery and leaves the message untouched');

  let other = null;
  try {
    await runWithTransientAuthRetry({
      tool: 'claude',
      argv: {},
      run: async () => {
        throw new Error('boom');
      },
    });
  } catch (error) {
    other = error.message;
  }
  assertEqual(other, 'boom', 'non-auth exceptions propagate unchanged');
}

console.log('\n--- Credential re-read ---');
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2296-creds-'));
  try {
    assertEqual(resolveCredentialFile({ tool: 'claude', env: {}, homeDir: '/h' }), '/h/.claude/.credentials.json', 'claude credential file');
    assertEqual(resolveCredentialFile({ tool: 'claude', env: { CLAUDE_CONFIG_DIR: '/cfg' }, homeDir: '/h' }), '/cfg/.credentials.json', 'CLAUDE_CONFIG_DIR is honoured');
    assertEqual(resolveCredentialFile({ tool: 'codex', env: {}, homeDir: '/h' }), '/h/.codex/auth.json', 'codex credential file');

    const jwt = `x.${Buffer.from(JSON.stringify({ exp: 2000000000 })).toString('base64url')}.y`;
    assertEqual(findCredentialExpiryMs({ claudeAiOauth: { expiresAt: 1790000000000 } }), 1790000000000, 'claude expiresAt (ms)');
    assertEqual(findCredentialExpiryMs({ tokens: { access_token: jwt } }), 2000000000000, 'codex JWT exp (s → ms)');

    const file = path.join(home, '.claude', '.credentials.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let clock = Date.parse('2026-09-25T00:00:00Z');
    fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { expiresAt: clock - 1000 } }));
    const since = fs.statSync(file).mtimeMs + 1;
    // Another process refreshes the token while we wait.
    const sleeps = [];
    const refreshed = await waitForCredentialRefresh({
      tool: 'claude',
      env: {},
      homeDir: home,
      since,
      maxWaitMs: 60_000,
      now: () => clock,
      sleep: async ms => {
        sleeps.push(ms);
        clock += ms;
        if (sleeps.length === 2) fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { expiresAt: clock + 3_600_000 } }));
      },
    });
    assertEqual([refreshed.ready, refreshed.changed, sleeps], [true, true, [5000, 10000]], 'polls with backoff until the credentials change');

    const stillValid = await waitForCredentialRefresh({ tool: 'claude', env: {}, homeDir: home, since: Date.now() + 1e9, now: () => clock, sleep: async () => assertEqual(true, false, 'no wait expected') });
    assertEqual([stillValid.ready, stillValid.changed], [true, false], 'a stored token that is not expired is used immediately');

    fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { expiresAt: 1 } }));
    let waited = 0;
    const timedOut = await waitForCredentialRefresh({
      tool: 'claude',
      env: {},
      homeDir: home,
      since: Date.now() + 1e9,
      maxWaitMs: 30_000,
      now: () => clock,
      sleep: async ms => {
        waited += ms;
        clock += ms;
      },
    });
    assertEqual([timedOut.ready, waited], [false, 30_000], 'gives up after the maximum wait and resumes anyway');

    const missing = await waitForCredentialRefresh({ tool: 'claude', env: {}, homeDir: path.join(home, 'none') });
    assertEqual([missing.ready, missing.waitedMs], [false, 0], 'no credential file (API key auth) → no wait');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n--- Codex scoped auth.json is reconciled newest-wins ---');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2296-codex-'));
  try {
    const primary = path.join(dir, 'base', 'auth.json');
    const copy = path.join(dir, 'scoped', 'auth.json');
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.writeFileSync(primary, '{"refresh_token":"r1"}');
    assertEqual(await reconcileCredentialCopy({ primary, copy }), 'copied-to-copy', 'the operator login is copied into a new scope');
    assertEqual(await reconcileCredentialCopy({ primary, copy }), 'unchanged', 'identical copies are left alone');
    fs.writeFileSync(copy, '{"refresh_token":"r2"}');
    fs.utimesSync(copy, new Date(), new Date(Date.now() + 5000));
    assertEqual(await reconcileCredentialCopy({ primary, copy }), 'copied-to-primary', 'a token refreshed inside the scope reaches the operator home');
    assertEqual(fs.readFileSync(primary, 'utf8'), '{"refresh_token":"r2"}', 'with the new (single-use) refresh token');
    fs.writeFileSync(primary, '{"refresh_token":"r3"}');
    fs.utimesSync(primary, new Date(), new Date(Date.now() + 10000));
    assertEqual([await reconcileCredentialCopy({ primary, copy }), fs.readFileSync(copy, 'utf8')], ['copied-to-copy', '{"refresh_token":"r3"}'], 'an operator refresh reaches the scope');
    assertEqual(
      fs.readdirSync(path.dirname(primary)).filter(name => name.endsWith('.tmp')),
      [],
      'no temp files are left behind'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
