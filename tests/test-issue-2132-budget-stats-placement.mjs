#!/usr/bin/env node

/**
 * Regression tests for issue #2132: context/cost budget stats must never go to
 * the working session summary, and `--attach-logs` disabled must disable them
 * entirely.
 *
 * Reported duplication (same session, two consecutive comments):
 *   https://github.com/link-assistant/formal-ai/pull/915#issuecomment-5168890917 (summary)
 *   https://github.com/link-assistant/formal-ai/pull/915#issuecomment-5168894369 (log)
 * Both carried the identical "### 💰 **Cost estimation:**" and
 * "### 📊 **Context and tokens usage:**" blocks.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAttachLogsEnabled, isTokensBudgetStatsEnabled, shouldPublishBudgetStats } from '../src/budget-stats-policy.lib.mjs';
import { buildWorkingSessionSummaryDetails, buildSessionBudgetStatsData } from '../src/solve.results.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(repoRoot, relative), 'utf8');

// --- the publication policy --------------------------------------------------

assert.equal(isAttachLogsEnabled({ attachLogs: true }), true);
assert.equal(isAttachLogsEnabled({ 'attach-logs': true }), true);
assert.equal(isAttachLogsEnabled({}), false);
assert.equal(isAttachLogsEnabled(null), false);
assert.equal(isTokensBudgetStatsEnabled({ tokensBudgetStats: true }), true);
assert.equal(isTokensBudgetStatsEnabled({ 'tokens-budget-stats': true }), true);
assert.equal(isTokensBudgetStatsEnabled({}), false);

// `--tokens-budget-stats` is on by default, so this is the reported default run:
// no `--attach-logs` ⇒ nothing about context/cost may be published.
assert.equal(shouldPublishBudgetStats({ tokensBudgetStats: true }), false, 'no --attach-logs ⇒ no published budget stats');
assert.equal(shouldPublishBudgetStats({ attachLogs: true }), false, '--no-tokens-budget-stats still wins');
assert.equal(shouldPublishBudgetStats({ tokensBudgetStats: true, attachLogs: true }), true);

// --- budget stats are never computed for publication without --attach-logs ---

const usage = {
  sessionId: 'session-2132',
  tempDir: '/tmp/does-not-matter-2132',
  pricingInfo: {
    tokenUsage: { inputTokens: 1000, outputTokens: 100 },
    modelName: 'Claude Fable 5',
  },
};

assert.equal(await buildSessionBudgetStatsData({ argv: { tokensBudgetStats: true }, ...usage }), null, 'without --attach-logs no budget stats data is produced at all');
assert.equal(await buildSessionBudgetStatsData({ argv: { tokensBudgetStats: false, attachLogs: true }, ...usage }), null, '--no-tokens-budget-stats produces no budget stats data');

// --- the summary never renders cost or budget --------------------------------

assert.equal(buildWorkingSessionSummaryDetails(), '', 'the summary details block is always empty');

const results = await read('src/solve.results.lib.mjs');
const summaryComment = results.slice(results.indexOf('export const attachSolutionSummary'), results.indexOf('export const maybeAttachWorkingSessionSummary'));
assert.ok(!summaryComment.includes('buildCostInfoString'), 'attachSolutionSummary must not render cost info');
assert.ok(!summaryComment.includes('buildBudgetStatsString'), 'attachSolutionSummary must not render budget stats');
assert.ok(!summaryComment.includes('usageDetails'), 'attachSolutionSummary must not append a usage details block');

// --- one shared implementation for every working session ---------------------

for (const file of ['src/solve.watch.lib.mjs', 'src/solve.auto-merge.lib.mjs']) {
  const source = await read(file);
  assert.ok(source.includes('buildSessionBudgetStatsData'), `${file} reuses the shared budget stats builder`);
  assert.ok(!/argv\.tokensBudgetStats && \w*[sS]essionId/.test(source), `${file} must not re-implement the budget stats gate`);
}

// The only place that renders budget stats into a GitHub comment is the log comment.
const renderers = [];
for (const file of ['src/solve.results.lib.mjs', 'src/github.lib.mjs', 'src/solve.watch.lib.mjs', 'src/solve.auto-merge.lib.mjs', 'src/solve.mjs']) {
  if ((await read(file)).includes('buildBudgetStatsString(')) renderers.push(file);
}
assert.deepEqual(renderers, ['src/github.lib.mjs'], `only the log comment renders budget stats, found: ${renderers.join(', ')}`);

console.log('Issue #2132 budget stats placement tests passed');
