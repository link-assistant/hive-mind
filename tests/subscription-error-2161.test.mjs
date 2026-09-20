#!/usr/bin/env node
/**
 * Subscription / account-access error detection tests (Issue #2161)
 *
 * Reproduces the failure from issue #2161: a 4h11m `/solve` run ended with only
 *
 *   ❌ CLAUDE execution failed with Your organization has disabled Claude
 *      subscription access for Claude Code · Use an Anthropic API key instead,
 *      or ask your admin to enable access
 *
 * The payload that produced it (docs/case-studies/issue-2161/solve-log.txt) is
 * replayed verbatim below. Before the fix nothing in the codebase recognised the
 * class: `classifyRetryableError` fell through to its unlabelled default and the
 * message was surfaced as a generic tool failure.
 *
 * Run with: node tests/subscription-error-2161.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2161
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSubscriptionError, isSubscriptionBlockedError, isTransientAuthError, formatSubscriptionErrorReport, formatSubscriptionErrorSummary, SUBSCRIPTION_BLOCKED_MARKER, SUBSCRIPTION_ERROR_KINDS } from '../src/subscription-error.lib.mjs';
import { classifyRetryableError } from '../src/tool-retry.lib.mjs';
import { isUsageLimitError } from '../src/usage-limit.lib.mjs';
import { parseSubscriptionBlockFromLog, formatSubscriptionBlockedSection } from '../src/subscription-block-telegram.lib.mjs';
import { buildSubscriptionBlockedExtraSection } from '../src/session-monitor.lib.mjs';
import { preloadAllLocales } from '../src/i18n.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// The exact message and result event captured in the issue's log.
const ISSUE_MESSAGE = 'Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access';
const ISSUE_RESULT_EVENT = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  terminal_reason: 'api_error',
  api_error_status: 403,
  error: 'oauth_org_not_allowed',
  result: ISSUE_MESSAGE,
  session_id: 'c8ca8b76-2882-4070-80ac-8d28562272e2',
};

console.log('\n📋 Subscription error detection tests (issue #2161)\n');

// ---------------------------------------------------------------------------
// The reproduction
// ---------------------------------------------------------------------------

test('detects the exact issue #2161 message from plain text', () => {
  const info = detectSubscriptionError(ISSUE_MESSAGE);
  assert.ok(info, 'expected the issue message to be recognised');
  assert.equal(info.kind, SUBSCRIPTION_ERROR_KINDS.ORG_SUBSCRIPTION_DISABLED);
  assert.ok(info.guidance.length > 0, 'expected actionable guidance');
});

test('detects the issue #2161 result event via its machine-readable code', () => {
  const info = detectSubscriptionError({
    message: ISSUE_RESULT_EVENT.result,
    tool: 'claude',
    errorCode: ISSUE_RESULT_EVENT.error,
    apiErrorStatus: ISSUE_RESULT_EVENT.api_error_status,
    terminalReason: ISSUE_RESULT_EVENT.terminal_reason,
  });
  assert.ok(info);
  assert.equal(info.code, 'oauth_org_not_allowed');
  assert.equal(info.apiErrorStatus, 403);
  assert.equal(info.kind, SUBSCRIPTION_ERROR_KINDS.ORG_SUBSCRIPTION_DISABLED);
});

test('the code alone is enough — no message needed', () => {
  const info = detectSubscriptionError({ errorCode: 'oauth_org_not_allowed', tool: 'claude' });
  assert.ok(info);
  assert.equal(info.kind, SUBSCRIPTION_ERROR_KINDS.ORG_SUBSCRIPTION_DISABLED);
});

test('the issue message is NOT a usage limit', () => {
  assert.equal(isUsageLimitError(ISSUE_MESSAGE), false);
});

test('classifyRetryableError marks it non-retryable with a subscription label', () => {
  const classification = classifyRetryableError(ISSUE_MESSAGE);
  assert.equal(classification.isRetryable, false, 'must not be retried — waiting cannot fix an account block');
  assert.equal(classification.isCapacity, false, 'must not trigger a fallback-model switch');
  assert.equal(classification.isSubscriptionError, true);
  assert.equal(classification.label, 'subscription access blocked');
});

// ---------------------------------------------------------------------------
// Provider coverage — strings transcribed from the shipped CLIs
// (docs/case-studies/issue-2161/provider-error-strings.md)
// ---------------------------------------------------------------------------

const PROVIDER_CASES = [
  ['claude', 'Your account does not have access to Claude. Please login again or contact your administrator.', SUBSCRIPTION_ERROR_KINDS.ACCOUNT_NO_ACCESS],
  ['claude', 'OAuth token revoked · Please run /login', SUBSCRIPTION_ERROR_KINDS.LOGIN_REQUIRED],
  ['claude', 'Login expired · Please run /login', SUBSCRIPTION_ERROR_KINDS.LOGIN_REQUIRED],
  ['claude', 'Credit balance is too low', SUBSCRIPTION_ERROR_KINDS.BILLING],
  ['claude', 'Your ANTHROPIC_API_KEY belongs to a disabled organization · Contact your admin', SUBSCRIPTION_ERROR_KINDS.ORG_SUBSCRIPTION_DISABLED],
  ['claude', 'Your organization has disabled API key authentication · Contact your admin', SUBSCRIPTION_ERROR_KINDS.ORG_SUBSCRIPTION_DISABLED],
  ['claude', 'Invalid API key · Fix external API key', SUBSCRIPTION_ERROR_KINDS.API_KEY_INVALID],
  ['claude', 'Claude Opus is not available with the Claude Pro plan. If you have updated your subscription plan recently, run /logout and /login for the plan to take effect.', SUBSCRIPTION_ERROR_KINDS.PLAN_RESTRICTED],
  ['codex', 'You do not have access to Codex', SUBSCRIPTION_ERROR_KINDS.ACCOUNT_NO_ACCESS],
  ['codex', 'This account is not currently authorized to use Codex in this workspace.', SUBSCRIPTION_ERROR_KINDS.ACCOUNT_NO_ACCESS],
  ['codex', 'Your access token could not be refreshed. Please log out and sign in again.', SUBSCRIPTION_ERROR_KINDS.LOGIN_REQUIRED],
  ['codex', 'OAuth refresh token was rejected: invalid_grant', SUBSCRIPTION_ERROR_KINDS.LOGIN_REQUIRED],
  ['qwen', "Refresh token expired or invalid. Please use '/auth' to re-authenticate.", SUBSCRIPTION_ERROR_KINDS.LOGIN_REQUIRED],
  ['qwen', 'Qwen OAuth credentials expired. Please use /auth to re-authenticate with qwen-oauth.', SUBSCRIPTION_ERROR_KINDS.LOGIN_REQUIRED],
  ['qwen', 'Coding Plan API key not found. Please re-authenticate with Coding Plan.', SUBSCRIPTION_ERROR_KINDS.PLAN_RESTRICTED],
  ['gemini', "The enforced authentication type is 'oauth-personal', but the current type is 'gemini-api-key'. Please re-authenticate with the correct type.", SUBSCRIPTION_ERROR_KINDS.LOGIN_REQUIRED],
  ['opencode', "OAuth token refresh failed and no fallback GITLAB_TOKEN environment variable is set. Refresh error: invalid_grant. Re-authenticate with 'opencode auth login gitlab'.", SUBSCRIPTION_ERROR_KINDS.LOGIN_REQUIRED],
];

for (const [tool, message, kind] of PROVIDER_CASES) {
  test(`[${tool}] detects: ${message.slice(0, 58)}…`, () => {
    const info = detectSubscriptionError({ message, tool });
    assert.ok(info, 'expected detection');
    assert.equal(info.kind, kind);
    assert.equal(classifyRetryableError(message).isRetryable, false);
  });
}

// ---------------------------------------------------------------------------
// False positives — these must stay on the retry path
// ---------------------------------------------------------------------------

test('transient auth network error is NOT a subscription block', () => {
  const message = 'Authentication error · This may be a temporary network issue, please try again';
  assert.equal(isTransientAuthError(message), true);
  assert.equal(isSubscriptionBlockedError(message), false);
  assert.equal(classifyRetryableError(message).isRetryable, true, 'the provider calls it temporary — keep retrying');
});

test('gateway upstream auth error is NOT a subscription block', () => {
  const message = 'Authentication error · The gateway could not authenticate with its upstream provider — contact your gateway administrator';
  assert.equal(isSubscriptionBlockedError(message), false);
});

test('usage limits are NOT subscription blocks', () => {
  assert.equal(isSubscriptionBlockedError('Claude AI usage limit reached|1755434100'), false);
  assert.equal(isSubscriptionBlockedError("You've hit your usage limit. Try again in 3 hours."), false);
});

test('ordinary API/capacity errors are NOT subscription blocks', () => {
  assert.equal(isSubscriptionBlockedError('API Error 529: Overloaded'), false);
  assert.equal(isSubscriptionBlockedError('The selected model is at capacity'), false);
  assert.equal(isSubscriptionBlockedError('Request timed out'), false);
  assert.equal(isSubscriptionBlockedError(''), false);
  assert.equal(isSubscriptionBlockedError(null), false);
  assert.equal(isSubscriptionBlockedError(undefined), false);
});

// ---------------------------------------------------------------------------
// Reporting — what the operator actually sees
// ---------------------------------------------------------------------------

test('the report carries the grep-able marker and the provider sentence', () => {
  const info = detectSubscriptionError({ message: ISSUE_MESSAGE, tool: 'claude', errorCode: 'oauth_org_not_allowed', apiErrorStatus: 403 });
  const lines = formatSubscriptionErrorReport(info, { tool: 'claude', sessionId: 'c8ca8b76', tempDir: '/tmp/x', branchName: 'issue-1-abc', committed: true });
  const text = lines.join('\n');
  assert.ok(text.includes(SUBSCRIPTION_BLOCKED_MARKER), 'marker missing');
  assert.ok(text.includes(ISSUE_MESSAGE), 'provider message missing');
  assert.ok(text.includes('oauth_org_not_allowed'), 'error code missing');
  assert.ok(text.includes('HTTP 403'), 'http status missing');
  assert.ok(text.includes('NOT a usage limit'), 'must state it is not a usage limit');
  assert.ok(text.includes('auto-committed'), 'must confirm the work was preserved');
  assert.ok(text.includes('c8ca8b76'), 'session id missing');
  assert.ok(text.includes('issue-1-abc'), 'branch missing');
});

test('the report is empty for a non-subscription error', () => {
  assert.deepEqual(formatSubscriptionErrorReport(null), []);
  assert.equal(formatSubscriptionErrorSummary(null), '');
});

test('the one-line summary names the tool and the cause', () => {
  const info = detectSubscriptionError({ message: ISSUE_MESSAGE, tool: 'claude', errorCode: 'oauth_org_not_allowed' });
  const summary = formatSubscriptionErrorSummary(info);
  assert.ok(summary.startsWith('CLAUDE stopped:'), summary);
  assert.ok(summary.includes('oauth_org_not_allowed'), summary);
});

// ---------------------------------------------------------------------------
// Wiring — the detector is useless unless the run actually stops on it
// ---------------------------------------------------------------------------

const read = name => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', name), 'utf8');

test('claude.lib.mjs reads the machine-readable error code, not just the text', () => {
  const source = read('claude.lib.mjs');
  assert.match(source, /detectSubscriptionError\(\{[\s\S]*?errorCode: typeof data\.error === 'string'/, 'must pass data.error through');
  assert.ok(source.includes('apiErrorStatus: data.api_error_status'), 'must pass api_error_status through');
  assert.ok(source.includes('subscriptionError, // Issue #2161'), 'must propagate the classification to the caller');
});

test('claude.lib.mjs never retries a subscription block', () => {
  const source = read('claude.lib.mjs');
  assert.ok(source.includes('isTransientError && !subscriptionError'), 'the transient retry path must be short-circuited');
});

test('solve.mjs preserves the work, then reports the block, then exits with the marker', () => {
  const source = read('solve.mjs');
  const commitAt = source.indexOf('commitUncommittedChangesOnCriticalError({ tempDir, branchName, $, log, reason: subscriptionInfo');
  const reportAt = source.indexOf('formatSubscriptionErrorReport(subscriptionInfo');
  const exitAt = source.indexOf('await safeExit(1, subscriptionInfo');
  assert.ok(commitAt > 0, 'emergency commit must name the subscription block as its reason');
  assert.ok(reportAt > commitAt, 'the report must come after the commit so it can state whether work was preserved');
  assert.ok(exitAt > reportAt, 'the run must exit after reporting');
  assert.ok(source.includes('SUBSCRIPTION_BLOCKED_MARKER'), 'the exit message must carry the marker for /hive and the monitor');
});

test('solve.mjs classifies every tool, not only the ones with structured codes', () => {
  const source = read('solve.mjs');
  assert.ok(source.includes('toolResult?.subscriptionError || detectSubscriptionError('), 'must fall back to re-classifying the rendered message');
});

test('hive.mjs stops the whole queue when a worker reports the block', () => {
  const source = read('hive.mjs');
  assert.ok(source.includes('if (line.includes(SUBSCRIPTION_BLOCKED_MARKER)) noteSubscriptionBlock(workerId, line)'), 'worker output must be scanned for the marker');
  assert.match(source, /noteSubscriptionBlock = \([\s\S]*?issueQueue\.stop\(\);/, 'the queue must be stopped');
  assert.ok(source.includes("await safeExit(1, 'Subscription/account access blocked')"), 'the hive must exit non-zero');
});

// ---------------------------------------------------------------------------
// Telegram — the operator must see the real cause on the surface they watch
// ---------------------------------------------------------------------------

const SESSION_LOG = [
  '📝 Starting solve...',
  ...formatSubscriptionErrorReport(detectSubscriptionError({ message: ISSUE_MESSAGE, tool: 'claude', errorCode: 'oauth_org_not_allowed', apiErrorStatus: 403 }), {
    sessionId: 'c8ca8b76-2882-4070-80ac-8d28562272e2',
    tempDir: '/tmp/gh-issue-solver-1',
    branchName: 'issue-1-abc',
    committed: true,
    resumeCommand: './solve.mjs https://github.com/o/r/issues/1 --resume c8ca8b76',
  }),
  '❌ CLAUDE execution failed',
].join('\n');

test('the block is parsed back out of the captured session log', () => {
  const parsed = parseSubscriptionBlockFromLog(SESSION_LOG);
  assert.ok(parsed, 'the marker must be found in the log');
  assert.equal(parsed.tool, 'CLAUDE');
  assert.ok(parsed.message.includes('disabled Claude subscription access'), parsed.message);
  assert.ok(parsed.code.includes('oauth_org_not_allowed'), parsed.code);
  assert.ok(parsed.code.includes('403'), parsed.code);
  assert.equal(parsed.committed, true);
  assert.ok(parsed.guidance.length > 0, 'the guidance steps must survive the round trip');
  assert.ok(parsed.resumeCommand.startsWith('./solve.mjs'), parsed.resumeCommand);
});

test('a log without the marker produces no Telegram section', () => {
  assert.equal(parseSubscriptionBlockFromLog('all good\n✅ done'), null);
  assert.equal(parseSubscriptionBlockFromLog(''), null);
  assert.equal(parseSubscriptionBlockFromLog(null), null);
  assert.equal(formatSubscriptionBlockedSection(null), '');
});

test('the Telegram section names the cause, the code and the preserved work', () => {
  const section = formatSubscriptionBlockedSection(parseSubscriptionBlockFromLog(SESSION_LOG));
  assert.ok(section.startsWith('🚫 '), section.slice(0, 40));
  assert.equal((section.match(/```/g) || []).length, 2, 'the body must be a single fenced block');
  assert.ok(section.includes('oauth_org_not_allowed'), section);
  assert.ok(section.includes('not a usage limit'), section);
  assert.ok(section.includes('auto-committed'), section);
});

await preloadAllLocales(); // the bot does this at startup; the test needs the same
test('the Telegram section is translated when the session has a locale', () => {
  const section = formatSubscriptionBlockedSection(parseSubscriptionBlockFromLog(SESSION_LOG), { locale: 'ru' });
  assert.ok(section.includes('Код ошибки'), section);
});

await (async () => {
  const section = await buildSubscriptionBlockedExtraSection('/session.log', { readFile: async () => SESSION_LOG });
  test('the session monitor builds the section from the session log', () => {
    assert.ok(section.includes('oauth_org_not_allowed'), section);
  });
  const empty = await buildSubscriptionBlockedExtraSection('/session.log', { readFile: async () => 'nothing to see' });
  test('the session monitor stays silent for healthy sessions', () => {
    assert.equal(empty, '');
  });
  const unreadable = await buildSubscriptionBlockedExtraSection('/missing.log', {
    readFile: async () => {
      throw new Error('ENOENT');
    },
  });
  test('an unreadable session log never breaks the completion message', () => {
    assert.equal(unreadable, '');
  });
})();

test('the completion message puts the block before every other section', () => {
  const source = read('session-monitor.lib.mjs');
  const idx = source.indexOf('extraSections: [...subscriptionBlockedExtraSections');
  assert.ok(idx > 0, 'the blocked section must be prepended to extraSections');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
