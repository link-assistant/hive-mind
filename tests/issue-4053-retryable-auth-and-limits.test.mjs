/**
 * @hive-mind-test-suite default
 *
 * Issue #4053: some errors should become retry-able and be handled better.
 *  - A Cloudflare 403 reported by Claude Code as `authentication_failed` is
 *    re-checked by retries (longer while the status page reports an incident)
 *    instead of stopping the run on the first occurrence.
 *  - /limits shows HTTP 5xx/timeouts as "temporarily unavailable … retried on
 *    the next /limits call" and never caches them.
 *  - The bare "(active)" subscription status is gone.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectSubscriptionError, formatSubscriptionDetectionLine, formatSubscriptionErrorReport, isEdgeBlockedResponse, SUBSCRIPTION_BLOCKED_MARKER } from '../src/subscription-error.lib.mjs';
import { classifyRetryableError, createTransientRetryBudget } from '../src/tool-retry.lib.mjs';
import { buildAuthFailureClaim, createAuthFailureRetry } from '../src/auth-failure-retry.lib.mjs';
import { formatProviderStatusSummary, parseStatuspageSummary, fetchProviderStatus, clearProviderStatusCache } from '../src/provider-status.lib.mjs';
import { describeLimitsFailure, isTemporaryLimitsHttpStatus, temporaryLimitsFailure } from '../src/limits-unavailable.lib.mjs';
import { formatSubscriptionBlockedSection, parseSubscriptionBlockFromLog } from '../src/subscription-block-telegram.lib.mjs';
import { displayableSubscriptionStatus } from '../src/limits-subscription.lib.mjs';
import { getCachedCodexLimits, resetLimitCache } from '../src/limits.lib.mjs';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'case-studies', 'issue-4053', 'data');
const CLOUDFLARE_MESSAGE = 'Failed to authenticate. API Error: 403 Attention Required! | Cloudflare';
const reportedEvent = () => detectSubscriptionError({ message: CLOUDFLARE_MESSAGE, tool: 'claude', errorCode: 'authentication_failed', apiErrorStatus: 403 });
const LIMITS = { maxAuthFailureRetries: 3, initialAuthFailureRetryDelayMs: 60000, maxAuthFailureRetryDelayMs: 600000, maxTransientErrorRetries: 100 };
const quietLog = async () => {};

test('the reported Cloudflare 403 is an unconfirmed (verifiable) access error, not a confirmed block', () => {
  const info = reportedEvent();
  assert.equal(info.isSubscriptionError, true);
  assert.equal(info.verifiable, true);
  assert.equal(info.transientEvidence, 'edge_block');
  const line = formatSubscriptionDetectionLine(info);
  assert.ok(!line.includes(SUBSCRIPTION_BLOCKED_MARKER), '/hive must not stop every worker for an error that will be re-checked');
  assert.match(line, /Unconfirmed access error/);
});

test('explicit provider wordings stay terminal and keep the hive stop marker', () => {
  const revoked = detectSubscriptionError({ message: 'OAuth token revoked. Please run /login', tool: 'claude', errorCode: 'authentication_failed' });
  assert.equal(revoked.verifiable, false);
  assert.ok(formatSubscriptionDetectionLine(revoked).startsWith(SUBSCRIPTION_BLOCKED_MARKER));
  const billing = detectSubscriptionError({ message: 'Your subscription has expired', tool: 'claude', errorCode: 'authentication_failed' });
  assert.equal(billing.kind, 'billing');
  assert.equal(billing.verifiable, false);
});

test('isEdgeBlockedResponse recognizes CDN challenge pages but not agent prose about HTML', () => {
  assert.equal(isEdgeBlockedResponse(CLOUDFLARE_MESSAGE), true);
  assert.equal(isEdgeBlockedResponse('API Error: 503 <!DOCTYPE html><html><title>Just a moment...</title>'), true);
  assert.equal(isEdgeBlockedResponse('I updated the <html> template and the README.'), false);
  assert.equal(isEdgeBlockedResponse(''), false);
});

test('classifyRetryableError retries an edge/CDN block for every tool', () => {
  const result = classifyRetryableError(CLOUDFLARE_MESSAGE);
  assert.equal(result.isRetryable, true);
  assert.match(result.label, /edge\/CDN block/);
  assert.equal(classifyRetryableError('OAuth token revoked. Please run /login').isRetryable, false);
});

test('auth-failure retry: bounded standard retries, then confirmed with a verification note', async () => {
  const statuses = [];
  const retry = createAuthFailureRetry({ tool: 'claude', log: quietLog, limits: LIMITS, fetchStatus: async () => (statuses.push(1), { ok: true, pageUrl: 'https://status.claude.com', hasIssues: false, description: 'All Systems Operational', activeIncidents: [], degradedComponents: [] }) });
  const delays = [];
  for (let i = 0; i < LIMITS.maxAuthFailureRetries; i += 1) {
    const decision = await retry.plan(reportedEvent());
    assert.equal(decision.retry, true);
    delays.push(decision.delayMs);
  }
  assert.deepEqual(delays, [60000, 120000, 240000]);
  const final = await retry.plan(reportedEvent());
  assert.equal(final.retry, false);
  assert.equal(final.subscriptionError.verification.retries, 3);
  assert.equal(final.subscriptionError.verification.extended, false);
  assert.match(final.subscriptionError.verification.statusSummary, /status\.claude\.com: All Systems Operational/);
  assert.equal(statuses.length, 4);
});

test('auth-failure retry keeps going while the status page reports an incident', async () => {
  const incident = parseStatuspageSummary(JSON.parse(await readFile(join(dataDir, 'status-claude-summary-2026-11-13.json'), 'utf8')), { tool: 'claude', pageUrl: 'https://status.claude.com' });
  const retry = createAuthFailureRetry({ tool: 'claude', log: quietLog, limits: LIMITS, fetchStatus: async () => ({ ...incident, hasIssues: true }) });
  for (let i = 0; i < LIMITS.maxAuthFailureRetries + 2; i += 1) {
    const decision = await retry.plan(reportedEvent());
    assert.equal(decision.retry, true, `retry ${i + 1} is allowed during an incident`);
    assert.equal(decision.extended, true);
    assert.ok(decision.delayMs <= LIMITS.maxAuthFailureRetryDelayMs);
  }
  retry.reset();
  assert.equal(retry.attempts, 0);
});

test('provider progress on the shared budget starts a fresh auth re-check window', async () => {
  const budget = createTransientRetryBudget({ budgetMs: 0 });
  const retry = createAuthFailureRetry({ tool: 'claude', budget, log: quietLog, limits: LIMITS, fetchStatus: async () => ({ ok: false, hasIssues: false, error: 'offline' }) });
  for (let i = 0; i < LIMITS.maxAuthFailureRetries; i += 1) assert.equal((await retry.plan(reportedEvent())).retry, true);
  assert.equal(budget.recordProgress(), true, 'the provider answered again');
  const afterRecovery = await retry.plan(reportedEvent());
  assert.equal(afterRecovery.retry, true);
  assert.equal(afterRecovery.delayMs, LIMITS.initialAuthFailureRetryDelayMs);
  assert.equal(retry.attempts, 1);
});

test('explicit wordings are never retried by the auth-failure policy', async () => {
  let fetched = false;
  const retry = createAuthFailureRetry({ tool: 'claude', log: quietLog, limits: LIMITS, fetchStatus: async () => ((fetched = true), { ok: false }) });
  const revoked = detectSubscriptionError({ message: 'OAuth token revoked. Please run /login', tool: 'claude', errorCode: 'authentication_failed' });
  const decision = await retry.plan(revoked);
  assert.equal(decision.retry, false);
  assert.equal(fetched, false);
});

test('retryOrConfirm preserves the session and waits before the retry', async () => {
  const retry = createAuthFailureRetry({ tool: 'claude', log: quietLog, limits: LIMITS, fetchStatus: async () => ({ ok: false, hasIssues: false, error: 'offline' }) });
  const argv = {};
  const waits = [];
  const decision = await retry.retryOrConfirm(reportedEvent(), { sessionId: 'session-1', argv, waitForRetryDelay: async ms => waits.push(ms) });
  assert.equal(decision.retry, true);
  assert.equal(argv.resume, 'session-1');
  assert.deepEqual(waits, [60000]);
});

test('buildAuthFailureClaim makes a bare Codex 401 verifiable but keeps explicit wordings terminal', () => {
  const claim = buildAuthFailureClaim({ tool: 'codex', message: 'unexpected status 401 Unauthorized', label: 'Codex authentication failed (401 Unauthorized)', apiErrorStatus: 401 });
  assert.equal(claim.verifiable, true);
  const explicit = buildAuthFailureClaim({ tool: 'claude', message: 'OAuth token revoked. Please run /login', label: 'x' });
  assert.equal(explicit.verifiable, false);
});

test('the confirmed report says how the error was re-checked, and Telegram shows it', () => {
  const info = { ...reportedEvent(), verification: { retries: 3, elapsed: '7m', statusSummary: 'status.claude.com: Partial System Outage — Auth issue (major, investigating)', extended: false } };
  const lines = formatSubscriptionErrorReport(info, { tool: 'claude' });
  const text = lines.join('\n');
  assert.match(text, /Retried: 3 time\(s\) over 7m/);
  assert.match(text, /Status page: status\.claude\.com: Partial System Outage/);
  assert.doesNotMatch(text, /NOT a transient API error/);
  const parsed = parseSubscriptionBlockFromLog(text);
  assert.match(parsed.retried, /^3 time\(s\) over 7m/);
  assert.match(parsed.statusPage, /^status\.claude\.com/);
  const section = formatSubscriptionBlockedSection(parsed, { locale: 'en' });
  assert.match(section, /Retried: 3 time/);
  assert.match(section, /Status page: status\.claude\.com/);
  assert.match(section, /re-checked with retries/);
});

test('Statuspage summary parsing and formatting use the incident snapshot', async () => {
  const body = JSON.parse(await readFile(join(dataDir, 'status-claude-summary-2026-11-13.json'), 'utf8'));
  const status = parseStatuspageSummary(body, { tool: 'claude', pageUrl: 'https://status.claude.com' });
  assert.equal(status.ok, true);
  const summary = formatProviderStatusSummary(status);
  assert.ok(summary.startsWith('status.claude.com: '));
  const healthy = parseStatuspageSummary({ status: { indicator: 'none', description: 'All Systems Operational' }, components: [], incidents: [] }, { tool: 'claude', pageUrl: 'https://status.claude.com' });
  assert.equal(healthy.hasIssues, false);
  assert.equal(formatProviderStatusSummary(healthy), 'status.claude.com: All Systems Operational');
  const outage = parseStatuspageSummary({ status: { indicator: 'major', description: 'Partial System Outage' }, components: [{ name: 'Claude Code', status: 'major_outage' }], incidents: [{ name: 'Authentication errors', status: 'investigating', impact: 'major' }] }, { tool: 'claude', pageUrl: 'https://status.claude.com' });
  assert.equal(outage.hasIssues, true);
  assert.match(formatProviderStatusSummary(outage), /Authentication errors \(major, investigating\)/);
});

test('unrelated status-page incidents do not extend auth retries', () => {
  const connector = { status: { indicator: 'minor', description: 'Partial System Degradation' }, components: [], incidents: [{ name: 'Elevated errors affecting the Microsoft 365 connector', status: 'investigating', impact: 'minor', components: [], incident_updates: [{ body: 'We are investigating an issue with Microsoft connectors where new connections may be broken.' }] }] };
  assert.equal(parseStatuspageSummary(connector, { tool: 'codex' }).hasIssues, false);
  const authIncident = { ...connector, incidents: [{ name: 'Elevated errors', status: 'investigating', impact: 'major', components: [], incident_updates: [{ body: 'Users may be unable to log in to ChatGPT and Codex.' }] }] };
  assert.equal(parseStatuspageSummary(authIncident, { tool: 'codex' }).hasIssues, true);
  const claudeIncident = { status: { indicator: 'major' }, components: [], incidents: [{ name: 'Elevated errors', status: 'investigating', impact: 'major', components: [{ name: 'Claude Code' }] }] };
  assert.equal(parseStatuspageSummary(claudeIncident, { tool: 'claude' }).hasIssues, true);
  assert.equal(parseStatuspageSummary({ ...claudeIncident, incidents: [{ ...claudeIncident.incidents[0], components: [{ name: 'Claude for Chrome' }] }] }, { tool: 'claude' }).hasIssues, false);
});

test('fetchProviderStatus never throws and caches the lookup', async () => {
  clearProviderStatusCache();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error('offline');
  };
  const first = await fetchProviderStatus('claude', { fetchImpl: failing, enabled: true, cacheMs: 60000 });
  const second = await fetchProviderStatus('claude', { fetchImpl: failing, enabled: true, cacheMs: 60000 });
  assert.equal(first.ok, false);
  assert.equal(first.hasIssues, false);
  assert.equal(second, first);
  assert.equal(calls, 1);
  clearProviderStatusCache();
  assert.equal((await fetchProviderStatus('agent', { enabled: true })).ok, false);
});

test('/limits: HTTP 503 is a temporary failure with a localized retry note', () => {
  assert.equal(isTemporaryLimitsHttpStatus(503), true);
  assert.equal(isTemporaryLimitsHttpStatus(408), true);
  assert.equal(isTemporaryLimitsHttpStatus(401), false);
  assert.equal(isTemporaryLimitsHttpStatus(429), false);
  const failure = temporaryLimitsFailure('claude', { status: 503, statusText: 'Service Unavailable' });
  assert.equal(failure.failureKind, 'temporary');
  assert.equal(failure.error, 'Claude limits are temporarily unavailable (HTTP 503 Service Unavailable). They will be retried on the next /limits call.');
  assert.match(describeLimitsFailure(temporaryLimitsFailure('codex', { cause: 'timeout' })), /^Codex limits are temporarily unavailable \(request timed out\)/);
  const ru = describeLimitsFailure(failure, { locale: 'ru' });
  assert.ok(ru && ru !== failure.error, 'Russian text is localized');
  assert.equal(describeLimitsFailure({ success: false, error: 'Codex authentication expired.' }), 'Codex authentication expired.');
});

test('/limits: a Router 503 is reported as temporary and retried on the next call', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'hive-4053-router-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    res.writeHead(503, { 'content-type': 'text/html' });
    res.end('<html>Service Unavailable</html>');
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const names = ['HIVE_MIND_USE_ROUTER', 'HIVE_MIND_ROUTER_URL', 'HIVE_MIND_ROUTER_TOKEN'];
  const previous = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, index) => (previous[index] === undefined ? delete process.env[name] : (process.env[name] = previous[index]))));
  process.env.HIVE_MIND_USE_ROUTER = '1';
  process.env.HIVE_MIND_ROUTER_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.HIVE_MIND_ROUTER_TOKEN = 'synthetic-router-client';
  resetLimitCache();
  const options = { authPath: join(root, 'missing-auth.json') };
  const first = await getCachedCodexLimits(false, options);
  const second = await getCachedCodexLimits(false, options);
  assert.equal(first.success, false);
  assert.equal(first.failureKind, 'temporary');
  assert.match(describeLimitsFailure(first), /Codex limits are temporarily unavailable \(HTTP 503\)\. They will be retried on the next \/limits call\./);
  assert.equal(second.failureKind, 'temporary');
  assert.equal(requests, 2, 'temporary failures are not cached');
});

test('subscription heading no longer shows a bare "(active)" status', () => {
  assert.equal(displayableSubscriptionStatus('active'), '');
  assert.equal(displayableSubscriptionStatus('trialing'), '');
  assert.equal(displayableSubscriptionStatus('past_due'), 'past_due');
});
