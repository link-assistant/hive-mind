#!/usr/bin/env node

/**
 * Regression tests for issue #2318: the changed-path list of the placeholder
 * description, pricing and title formatting.
 *
 * - The description solve writes when the agent left the placeholder in place
 *   (#1162) lists the changed paths in a marked "### Changes" section. Issue
 *   #2549: a description the agent wrote is no longer regenerated afterwards;
 *   that is covered by pr-description-preservation-2549.test.mjs.
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

import { formatChangesSection, getPullRequestChangeStats } from '../src/pull-request-changes.lib.mjs';
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

const fileDiff = (file, lines) => [`diff --git a/${file} b/${file}`, 'new file mode 100644', '--- /dev/null', `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)].join('\n');
// The Kotlin branch on 2026-09-27: the program, the workflow and the build files.
const KOTLIN_DIFF = [fileDiff('src/main/kotlin/Main.kt', ['fun main() {', '    println("Hello, World!")', '}']), fileDiff('.github/workflows/ci.yml', ['name: CI', 'on: [push]']), fileDiff('verify.sh', ['#!/bin/sh'])].join('\n');
const STATS = { hasChanges: true, measured: true, filesChanged: 3, additions: 6, deletions: 0, files: ['src/main/kotlin/Main.kt', '.github/workflows/ci.yml', 'verify.sh'] };

console.log('Issue #2318: the placeholder description lists the diff; one cost for a free model; no quoted titles\n');

await test('the marked Changes section lists the summary and the changed paths', () => {
  const section = formatChangesSection(STATS);
  assert.ok(section.startsWith('<!-- hive-mind:changes:start -->\n### Changes\n- 3 file(s) modified\n- 6 line(s) added\n- 0 line(s) removed\n- Files:\n'));
  assert.match(section, / {2}- `src\/main\/kotlin\/Main\.kt`/);
  assert.ok(section.endsWith('<!-- hive-mind:changes:end -->'));
});

await test('the file list is capped', () => {
  const files = Array.from({ length: 53 }, (_, index) => `f${index}.txt`);
  const section = formatChangesSection({ ...STATS, filesChanged: 53, files });
  assert.match(section, /`f49\.txt`/);
  assert.doesNotMatch(section, /`f50\.txt`/);
  assert.match(section, /…and 3 more/);
});

await test('getPullRequestChangeStats lists the changed paths', async () => {
  const $ = first => {
    if (!Array.isArray(first)) return $;
    return Promise.resolve({ code: 0, stdout: KOTLIN_DIFF, stderr: '' });
  };
  const stats = await getPullRequestChangeStats({ owner: 'o', repo: 'r', prNumber: 2, $ });
  assert.deepEqual(stats.files, ['src/main/kotlin/Main.kt', '.github/workflows/ci.yml', 'verify.sh']);
});

await test('only the placeholder replacement renders the section', () => {
  const results = read('src/solve.results.lib.mjs');
  assert.match(results, /\$\{formatChangesSection\(changeStats\)\}/, 'the placeholder body uses the marked section');
  assert.equal(results.match(/formatChangesSection\(/g).length, 1);
  assert.doesNotMatch(read('src/solve.restart-shared.lib.mjs'), /formatChangesSection|refreshPullRequestChangesSection/);
});

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
