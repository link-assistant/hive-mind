#!/usr/bin/env node
/**
 * Issue #1710: verify the new `dumpBudgetTrace` helper.
 *
 * `dumpBudgetTrace` is the verbose-only diagnostic added so that the next
 * "calculation correctness" report can be triaged from the saved log alone.
 * It must:
 *  1. Always log with `{verbose: true}` so the default solver output is
 *     unaffected.
 *  2. Surface the raw inputs that drive the renderer: peak request fill,
 *     cumulative input / cache_write (5m / 1h split) / cache_read / output,
 *     and server-tool counts (web search).
 *  3. When `webSearchRequests > 0`, print the implied dollar cost at
 *     $0.01 / request — that is the source of the "+$0.04 (+0.16%)"
 *     residual the issue called out.
 *  4. Note when usage data was supplemented from the result event
 *     (`_sourceResultJson`).
 *  5. Not crash on partial inputs (e.g. no `modelInfo`).
 */

import assert from 'node:assert/strict';
import { dumpBudgetTrace } from '../src/claude.budget-stats.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

const runTest = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
    testsFailed++;
  }
};

// Minimal log capture: collects (text, options) calls.
const makeLog = () => {
  const calls = [];
  const log = async (text, options) => {
    calls.push({ text, options });
  };
  log.calls = calls;
  return log;
};

const opusUsage = {
  // Numbers are the actual values from the PR #1707 run that triggered
  // issue #1710 — see docs/case-studies/issue-1710/facts.md.
  modelName: 'Claude Opus 4.7',
  modelInfo: { limit: { context: 1_000_000, output: 128_000 } },
  inputTokens: 690,
  cacheCreationTokens: 341_517,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 341_517,
  cacheReadTokens: 42_679_751,
  outputTokens: 79_567,
  webSearchRequests: 0,
  peakContextUsage: 278_218,
  costUSD: 25.466981749999988,
};

const haikuUsage = {
  modelName: 'Claude Haiku 4.5',
  modelInfo: { limit: { context: 200_000, output: 64_000 } },
  inputTokens: 77_969,
  cacheCreationTokens: 57_580,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 57_580,
  cacheReadTokens: 0,
  outputTokens: 4_176,
  webSearchRequests: 4,
  peakContextUsage: 0, // sub-agent
  costUSD: 0.170824,
  _resultCostUSD: 0.210824,
  _sourceResultJson: true,
};

await runTest('every line is gated behind {verbose: true}', async () => {
  const log = makeLog();
  await dumpBudgetTrace(opusUsage, { subSessions: [] }, log);
  assert.ok(log.calls.length > 0, 'should emit at least one line');
  for (const call of log.calls) {
    assert.deepEqual(call.options, { verbose: true }, `every line must use {verbose: true}; offending line: ${call.text}`);
  }
});

await runTest('renders peak request line with context limit when known', async () => {
  const log = makeLog();
  await dumpBudgetTrace(opusUsage, { subSessions: [] }, log);
  const joined = log.calls.map(c => c.text).join('\n');
  assert.match(joined, /peak request:\s+278 218/, 'peak request value missing');
  assert.match(joined, /1 000 000 context/, 'context limit missing');
});

await runTest('renders cumulative line splitting cache writes by tier', async () => {
  const log = makeLog();
  await dumpBudgetTrace(opusUsage, { subSessions: [] }, log);
  const joined = log.calls.map(c => c.text).join('\n');
  assert.match(joined, /input 690/, 'input tokens missing');
  assert.match(joined, /cache_write 341 517/, 'cache_write missing');
  assert.match(joined, /5m 0/, 'cache_write 5m split missing');
  assert.match(joined, /1h 341 517/, 'cache_write 1h split missing');
  assert.match(joined, /cache_read 42 679 751/, 'cache_read missing');
  assert.match(joined, /output 79 567/, 'output tokens missing');
});

await runTest('annotates web_search residual cost when count > 0', async () => {
  const log = makeLog();
  await dumpBudgetTrace(haikuUsage, { subSessions: [] }, log);
  const joined = log.calls.map(c => c.text).join('\n');
  assert.match(joined, /web_search 4/, 'web search count missing');
  assert.match(joined, /\$0\.040000/, 'implied $0.04 cost missing — this is the residual from issue #1710');
  assert.match(joined, /\$10 \/ 1k searches/, 'must cite the documented per-search rate');
});

await runTest('omits web_search dollar annotation when count is 0', async () => {
  const log = makeLog();
  await dumpBudgetTrace(opusUsage, { subSessions: [] }, log);
  const joined = log.calls.map(c => c.text).join('\n');
  assert.match(joined, /web_search 0/, 'should still report the count');
  assert.doesNotMatch(joined, /not included in calculateModelCost/, 'should not annotate when there is no residual');
});

await runTest('surfaces both public and Anthropic costs when both available', async () => {
  const log = makeLog();
  await dumpBudgetTrace(haikuUsage, { subSessions: [] }, log);
  const joined = log.calls.map(c => c.text).join('\n');
  assert.match(joined, /cost \(public\):\s+\$0\.170824/);
  assert.match(joined, /cost \(anthropic result-event\):\s+\$0\.210824/);
});

await runTest('reports sub-session count from tokenUsage', async () => {
  const log = makeLog();
  await dumpBudgetTrace(opusUsage, { subSessions: [{}, {}, {}] }, log);
  const joined = log.calls.map(c => c.text).join('\n');
  assert.match(joined, /sub-session count: 3/);
});

await runTest('reports data source as result-event when supplemented', async () => {
  const log = makeLog();
  await dumpBudgetTrace(haikuUsage, { subSessions: [] }, log);
  const joined = log.calls.map(c => c.text).join('\n');
  assert.match(joined, /data source:\s+jsonl \+ result-event/);
});

await runTest('reports data source as jsonl-only when not supplemented', async () => {
  const log = makeLog();
  await dumpBudgetTrace(opusUsage, { subSessions: [] }, log);
  const joined = log.calls.map(c => c.text).join('\n');
  assert.match(joined, /data source:\s+jsonl(?!\s*\+)/);
});

await runTest('does not crash with a minimal usage object', async () => {
  const log = makeLog();
  await dumpBudgetTrace({ modelName: 'X' }, null, log);
  // No assertion on content; just that we did not throw.
  assert.ok(log.calls.length > 0);
});

console.log(`\n📊 Tests: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
