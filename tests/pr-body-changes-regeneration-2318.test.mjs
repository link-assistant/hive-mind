#!/usr/bin/env node

/**
 * Regression tests for issue #2318 pricing and title formatting.
 * Description ownership is covered by pr-description-preservation-2549.test.mjs.
 *
 * - Kotlin comment: `Public pricing estimate: $0.00 (Free model)` next to
 *   `Total: 122.3K input tokens, 4.4K output tokens, $0.576812 cost`.
 * - Kotlin/Scala titles `'Implement Hello World in Kotlin'`: renamed on
 *   2026-07-30 by `--title "${updatedTitle}"`, fixed by 46b2df22 (#2119).
 *   Pinned here so the quoted form cannot come back.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2318
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';
import { buildCostInfoString, isFreeModelPricing } from '../src/github-cost-info.lib.mjs';
import { buildFormalAiPricingInfo } from '../src/formal-ai-pricing.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${description}`);
    console.log(`      ${error.stack || error.message}`);
    failed++;
  }
};

console.log('Issue #2318: one cost for a free model; no quoted titles\n');

// The Kotlin session's usage: claude's result event priced "formal-ai" at $0.576812.
const kotlinTokenUsage = () => ({
  modelUsage: {
    'formal-ai': { inputTokens: 122288, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 4383, costUSD: 0.576812, _resultCostUSD: 0.576812, modelName: 'formal-ai', modelInfo: { limit: { context: 200000, output: 32000 } }, peakContextUsage: 16055 },
  },
  subSessions: [],
});

await test('a free model prints one cost: the $0.00 estimate, no list-price Total cost', () => {
  const pricingInfo = buildFormalAiPricingInfo('formal-ai');
  assert.equal(isFreeModelPricing(pricingInfo), true);
  const comment = buildBudgetStatsString(kotlinTokenUsage(), null, { freeModel: isFreeModelPricing(pricingInfo) }) + buildCostInfoString(0, null, pricingInfo);
  assert.match(comment, /Public pricing estimate: \$0\.00 \(Free model\)/);
  assert.match(comment, /Total: 122\.3K input tokens, 4\.4K output tokens/);
  assert.doesNotMatch(comment, /0\.576812/);
  assert.equal(comment.match(/\$\d/g).length, 1, comment);
});

await test('a priced model keeps its per-model cost; a free model priced via a base model is not "free"', () => {
  assert.match(buildBudgetStatsString(kotlinTokenUsage()), /4\.4K output tokens, \$0\.576812 cost/);
  assert.equal(isFreeModelPricing({ isFreeModel: true, baseModelName: 'kimi-k2.5' }), false);
  assert.equal(isFreeModelPricing(null), false);
  assert.match(read('src/github.lib.mjs'), /buildBudgetStatsString\(budgetStatsData\.tokenUsage, budgetStatsData\.subAgentCalls, \{ freeModel: isFreeModelPricing\(pricingInfo\) \}\)/);
});

await test('PR titles are passed as one unquoted argument', () => {
  // The 2026-07-30 rename `[WIP] Implement Hello World in Kotlin` -> `'Implement Hello World in Kotlin'`
  // came from `--title "${updatedTitle}"`: command-stream quotes the value itself.
  const results = read('src/solve.results.lib.mjs');
  assert.match(results, /gh pr edit \$\{pr\.number\} --repo \$\{owner\}\/\$\{repo\} --title \$\{updatedTitle\}`/);
  const autoPr = read('src/solve.auto-pr.lib.mjs');
  assert.match(autoPr, /--title "\$\(cat '\$\{prTitleFile\}'\)"/, 'gh pr create reads the title from a file');
  for (const file of ['src/solve.results.lib.mjs', 'src/solve.auto-pr.lib.mjs']) {
    assert.doesNotMatch(read(file), /--title "\$\{/, `${file}: no quoted --title interpolation`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
