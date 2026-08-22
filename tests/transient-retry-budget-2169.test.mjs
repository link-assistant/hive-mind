#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2169 — "❌ Transient API error persisted after 10 retries".
 *
 * Captured evidence: docs/case-studies/issue-2169/logs/run.log.txt (execution
 * bb1c1a05-5394-4845-a88c-d4ddf9f2361c). Every one of the 11 Claude attempts ended with
 * `"subtype": "success"`, `is_error: false`, `api_error_status: null` — yet the run retried
 * 10 times over 3 h 54 min and then exited 1. Two independent defects:
 *
 *   1. `classifyRetryableError()` matched a bare three-digit `52x` anywhere in the text, so the
 *      agent's own success summary ("PR: .../pull/524", "issue #523", "(`463c5ca`, PR #522)")
 *      was read as a Cloudflare gateway error.
 *   2. `claude.lib.mjs` applied the transient-retry gate even when the run had succeeded
 *      (`(commandFailed || isTransientError) && isTransientError`), so a matching pattern in a
 *      *successful* result restarted the whole session.
 *
 * The issue also asked for the retry window itself to grow: exponential backoff "with up to 12
 * hours of retries in total (must be configurable), with minimum of 3 minutes".
 */

import assert from 'node:assert/strict';
import fsModule, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import osModule, { tmpdir } from 'node:os';
import pathModule, { join } from 'node:path';

const testHome = mkdtempSync(join(tmpdir(), 'issue-2169-home-'));
process.env.HOME = testHome;

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fsModule, default: fsModule };
  if (packageName === 'os') return { ...osModule, default: osModule };
  if (packageName === 'path') return { ...pathModule, default: pathModule };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return await import(packageName);
};

const { retryLimits } = await import('../src/config.lib.mjs');
const { classifyRetryableError, createTransientRetryBudget, describeClassificationEvidence, formatRetryDuration, getRetryDelayMs, matchesHttpStatus } = await import('../src/tool-retry.lib.mjs');
const { executeClaudeCommand } = await import('../src/claude.lib.mjs');

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
};

// ============================================================
// 1. The exact false positives from the captured run
// ============================================================
console.log('=== 1. Success summaries from the captured run are NOT transient API errors ===');

// Verbatim `   Error:` payloads from docs/case-studies/issue-2169/logs/run.log.txt.
const CAPTURED_SUCCESS_SUMMARIES = ['Готово. PR: https://github.com/G-Ivan-A/hybrid-Intelligence-lab/pull/524 (ветка issue-523-...)', 'The work on issue #523 is complete. PR #524 is open and CI is green.', 'Все изменения уже влиты (`463c5ca`, PR #522), задача закрыта.', 'Fixed in commit 520f1ab and released as v1.523.0', 'See https://github.com/G-Ivan-A/hybrid-Intelligence-lab/issues/523 for context'];

for (const summary of CAPTURED_SUCCESS_SUMMARIES) {
  await test(`not retryable: ${summary.slice(0, 56)}…`, () => {
    const classified = classifyRetryableError(summary);
    assert.equal(classified.isRetryable, false, `must not be classified as retryable (label: ${classified.label})`);
    assert.equal(classified.label, null);
  });
}

// ============================================================
// 2. Genuine gateway errors must still be retried
// ============================================================
console.log('\n=== 2. Genuine gateway/status errors still classify as retryable ===');

const REAL_GATEWAY_ERRORS = ['502 Bad Gateway', '504 Gateway Timeout', 'error code: 522', 'API Error: 502 <html>...', 'HTTP 520: Unknown Error', 'Error 524: A Timeout Occurred', 'status code: 503'];

for (const message of REAL_GATEWAY_ERRORS) {
  await test(`retryable: ${message.slice(0, 40)}`, () => {
    assert.equal(classifyRetryableError(message).isRetryable, true, `"${message}" must stay retryable`);
  });
}

await test('matchesHttpStatus requires an error-ish prefix or a known status phrase', () => {
  assert.equal(matchesHttpStatus('merged pr 524 into main', '502|504|52[0-4]'), false);
  assert.equal(matchesHttpStatus('api error: 522', '502|504|52[0-4]'), true);
});

// ============================================================
// 3. A successful Claude run is never retried (root cause #2)
// ============================================================
console.log('\n=== 3. A successful Claude result is never sent through the retry loop ===');

const renderCommand = (strings, values) => strings.reduce((command, part, index) => command + part + (index < values.length ? String(values[index]) : ''), '');

const buildFakeDollar = responses => {
  const calls = [];
  const fakeDollar =
    options =>
    (strings, ...values) => {
      const response = responses.shift() || { chunks: [], code: 0 };
      calls.push({ options, command: renderCommand(strings, values) });
      return {
        pid: 20000 + calls.length,
        result: { code: response.code ?? 0 },
        kill: () => {},
        async *stream() {
          for (const chunk of response.chunks || []) yield chunk;
        },
      };
    };
  fakeDollar.calls = calls;
  return fakeDollar;
};

const jsonLinesChunk = events => ({ type: 'stdout', data: Buffer.from(`${events.map(event => JSON.stringify(event)).join('\n')}\n`) });

const buildExecutionParams = ({ fakeDollar, logs }) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'issue-2169-work-'));
  const initialLogFile = join(tempDir, 'current.log');
  writeFileSync(initialLogFile, '');
  let logFile = initialLogFile;
  return {
    tempDir,
    branchName: 'issue-2169-test',
    prompt: 'Continue.',
    systemPrompt: 'Solve the issue.',
    escapedPrompt: 'Continue.',
    escapedSystemPrompt: 'Solve the issue.',
    argv: {
      model: 'opus',
      tool: 'claude',
      url: 'https://github.com/link-assistant/hive-mind/issues/2169',
      verbose: false,
      fallbackModel: null,
      disable1mContext: false,
      uselessToolsDisabled: false,
    },
    log: async message => logs.push(String(message)),
    setLogFile: nextLogFile => {
      logFile = nextLogFile;
    },
    getLogFile: () => logFile,
    formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
    getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    claudePath: 'claude',
    $: fakeDollar,
    owner: 'link-assistant',
    repo: 'hive-mind',
    prNumber: 2172,
    issueNumber: 2169,
  };
};

await test('a success result mentioning "pull/524" runs exactly once and succeeds', async () => {
  const logs = [];
  // Reconstruction of the captured terminal event (log line 16187 onwards).
  const successEvents = [
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      api_error_status: null,
      result: 'Готово. PR: https://github.com/G-Ivan-A/hybrid-Intelligence-lab/pull/524 (ветка issue-523-...)',
      total_cost_usd: 1.23,
      num_turns: 42,
      session_id: 'session-2169',
    },
  ];
  const fakeDollar = buildFakeDollar([{ chunks: [jsonLinesChunk(successEvents)], code: 0 }]);
  const params = buildExecutionParams({ fakeDollar, logs });
  try {
    const result = await executeClaudeCommand(params);
    assert.equal(result.success, true, 'a successful session must be reported as success');
    assert.equal(fakeDollar.calls.length, 1, 'the session must not be re-executed');
    const output = logs.join('\n');
    assert.ok(!/Retry attempt/.test(output), 'must not log a retry attempt');
    assert.ok(!/Transient API error persisted/.test(output), 'must not report the issue #2169 failure');
  } finally {
    rmSync(params.tempDir, { recursive: true, force: true });
  }
});

// ============================================================
// 4. Backoff: 3-minute minimum, 12-hour budget, configurable
// ============================================================
console.log('\n=== 4. Exponential backoff with a 3-minute minimum and a 12-hour budget ===');

await test('defaults implement the issue requirements', () => {
  assert.equal(retryLimits.minTransientErrorDelayMs, 3 * 60 * 1000, 'minimum retry delay must be 3 minutes');
  assert.equal(retryLimits.initialTransientErrorDelayMs, 3 * 60 * 1000, 'first backoff must be the 3-minute minimum');
  assert.equal(retryLimits.transientErrorRetryBudgetMs, 12 * 60 * 60 * 1000, 'total retry budget must be 12 hours');
  assert.equal(retryLimits.retryBackoffMultiplier, 2, 'backoff must stay exponential');
});

await test('every backoff honours the 3-minute floor, even when misconfigured', () => {
  const delay = getRetryDelayMs({ retryCount: 0, initialDelayMs: 5000, maxDelayMs: 30 * 60 * 1000, minDelayMs: retryLimits.minTransientErrorDelayMs });
  assert.equal(delay, 3 * 60 * 1000, `a 5s configured delay must be raised to the 3-minute floor, got ${delay}`);
});

await test('the floor never exceeds the configured maximum', () => {
  const delay = getRetryDelayMs({ retryCount: 0, initialDelayMs: 1000, maxDelayMs: 60 * 1000, minDelayMs: 3 * 60 * 1000 });
  assert.equal(delay, 60 * 1000, 'minDelayMs must be clamped by maxDelayMs');
});

// Deterministic simulation of a total provider outage using an injected clock.
const simulateOutage = ({ budgetMs = retryLimits.transientErrorRetryBudgetMs, maxRetries = retryLimits.maxTransientErrorRetries } = {}) => {
  let clock = 0;
  const budget = createTransientRetryBudget({ budgetMs, now: () => clock });
  const delays = [];
  let retryCount = 0;
  let decision;
  for (;;) {
    decision = budget.evaluate({
      retryCount,
      maxRetries,
      initialDelayMs: retryLimits.initialTransientErrorDelayMs,
      maxDelayMs: retryLimits.maxTransientErrorDelayMs,
      minDelayMs: retryLimits.minTransientErrorDelayMs,
    });
    if (!decision.allowed) break;
    budget.grant();
    delays.push(decision.delayMs);
    clock += decision.delayMs;
    retryCount++;
  }
  return { delays, totalMs: clock, decision, budget };
};

await test('a 12-hour outage yields >20 retries spanning close to 12 hours', () => {
  const { delays, totalMs, decision } = simulateOutage();
  assert.ok(delays.length > 20, `expected more than 20 retries, got ${delays.length}`);
  assert.ok(totalMs <= 12 * 60 * 60 * 1000, `retrying must not exceed the 12-hour budget, spent ${totalMs}ms`);
  assert.ok(totalMs >= 11 * 60 * 60 * 1000, `retrying must use most of the 12-hour budget, spent only ${totalMs}ms`);
  assert.equal(decision.reason, 'budget', 'the budget, not the attempt count, must be the stop condition');
  // The old behaviour: 10 retries of 2→30 min ≈ 3 h 54 min (the captured run).
  assert.ok(delays.length > 10, 'must retry far more than the 10 attempts of the reported failure');
});

await test('the backoff schedule starts at 3 minutes and doubles up to the 30-minute cap', () => {
  const { delays } = simulateOutage();
  assert.deepEqual(
    delays.slice(0, 5),
    [3, 6, 12, 24, 30].map(minutes => minutes * 60 * 1000)
  );
  assert.ok(
    delays.every(delay => delay <= retryLimits.maxTransientErrorDelayMs),
    'no delay may exceed the cap'
  );
});

await test('the budget is configurable (shorter budget → fewer retries)', () => {
  const short = simulateOutage({ budgetMs: 30 * 60 * 1000 });
  assert.ok(short.totalMs <= 30 * 60 * 1000, 'a 30-minute budget must be respected');
  assert.ok(short.delays.length < simulateOutage().delays.length, 'a smaller budget must produce fewer retries');
});

await test('the attempt count remains a runaway backstop', () => {
  const capped = simulateOutage({ maxRetries: 3 });
  assert.equal(capped.delays.length, 3);
  assert.equal(capped.decision.reason, 'count');
  assert.match(capped.budget.describeExhaustion(capped.decision), /retry limit of 3 attempts reached/);
});

await test('budgetMs = 0 disables the budget (count cap only)', () => {
  const unlimited = simulateOutage({ budgetMs: 0, maxRetries: 5 });
  assert.equal(unlimited.delays.length, 5);
  assert.equal(unlimited.decision.reason, 'count');
  assert.equal(unlimited.budget.describeProgress(), 'budget disabled');
});

await test('exhaustion is reported with the elapsed window, not just a retry count', () => {
  const { budget, decision } = simulateOutage();
  const description = budget.describeExhaustion(decision);
  assert.match(description, /retry budget of 12h exhausted after \d+ retries over \d+h/);
});

await test('formatRetryDuration renders seconds, minutes and hours', () => {
  assert.equal(formatRetryDuration(30 * 1000), '30s');
  assert.equal(formatRetryDuration(12 * 60 * 1000), '12 min');
  assert.equal(formatRetryDuration(12 * 60 * 60 * 1000), '12h');
  assert.equal(formatRetryDuration(11 * 60 * 60 * 1000 + 45 * 60 * 1000), '11h 45m');
});

await test('describeClassificationEvidence surfaces status tokens hidden past the 200-character log excerpt', () => {
  // The reported run logged only `lastMessage.substring(0, 200)`, so the "PR #524" token that made
  // the classifier fire was invisible. The evidence line must expose it wherever it sits.
  const message = `${'Summary of the work done. '.repeat(80)}Opened PR #524 for the fix.`;
  const evidence = describeClassificationEvidence(message, '52x gateway error');
  assert.match(evidence, /label="52x gateway error"/);
  assert.match(evidence, new RegExp(`messageChars=${message.length}`));
  assert.match(evidence, /statusTokens=\[@\d+ "[^"]*PR #524[^"]*"\]/, `expected the PR #524 context, got: ${evidence}`);
  assert.ok(message.indexOf('524') > 200, 'the token must sit past the truncated excerpt for this test to be meaningful');
});

await test('describeClassificationEvidence reports an empty token list and tolerates missing input', () => {
  assert.match(describeClassificationEvidence('Connection reset by peer', 'network error'), /statusTokens=\[\]$/);
  assert.match(describeClassificationEvidence(null), /label=null messageChars=0 statusTokens=\[\]/);
});

await test('describeClassificationEvidence caps the number of reported tokens', () => {
  const evidence = describeClassificationEvidence('API Error: 500 502 503 504 529', 'many', { maxMatches: 2 });
  assert.equal(evidence.split('@').length - 1, 2, `expected exactly 2 reported tokens, got: ${evidence}`);
});

rmSync(testHome, { recursive: true, force: true });

console.log(`\nTotal: ${passed + failed} tests, ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
