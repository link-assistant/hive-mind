#!/usr/bin/env node

/**
 * Regression test for issue #2318: the PR description was never regenerated
 * from the real diff, a free model's comment printed two costs, and PR titles
 * carried literal quotes.
 *
 * - Kotlin PR body (July): "1 file(s) modified, 1 line(s) added" while the
 *   branch had six files. The "### Changes" section is now owned by solve,
 *   delimited by markers, and regenerated from `gh pr diff` at the end of every
 *   session for every model; the issue reference and human text are kept.
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

import { CHANGES_SECTION_END, CHANGES_SECTION_START, formatChangesSection, getPullRequestChangeStats, refreshPullRequestChangesSection, replaceChangesSection } from '../src/pull-request-changes.lib.mjs';
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

const FOOTER = '---\n*This PR was created automatically by the AI issue solver*';
// The Kotlin PR body as published on 2026-07-30 (unchanged until 2026-09-27).
const KOTLIN_BODY = `## Summary\n\nThis pull request implements a solution for #1: Implement Hello World in Kotlin\n\n### Changes\n- 1 file(s) modified\n- 1 line(s) added\n- 0 line(s) removed\n\n### Issue Reference\nFixes #1\n\n${FOOTER}`;
const RUST_BODY = `## Summary\n\nThis pull request implements a solution for #1: Implement Hello World in Rust\n\n### Changes\n- No files were changed by this pull request yet (it contains only the placeholder file the solver commits to open a pull request)\n\n### Issue Reference\nFixes #1\n\n${FOOTER}`;

const fileDiff = (file, lines) => [`diff --git a/${file} b/${file}`, 'new file mode 100644', '--- /dev/null', `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)].join('\n');
// The Kotlin branch on 2026-09-27: the program, the workflow and the build files.
const KOTLIN_DIFF = [fileDiff('src/main/kotlin/Main.kt', ['fun main() {', '    println("Hello, World!")', '}']), fileDiff('.github/workflows/ci.yml', ['name: CI', 'on: [push]']), fileDiff('verify.sh', ['#!/bin/sh'])].join('\n');
const STATS = { hasChanges: true, measured: true, filesChanged: 3, additions: 6, deletions: 0, files: ['src/main/kotlin/Main.kt', '.github/workflows/ci.yml', 'verify.sh'] };

/** A fake command-stream `$` answering `gh pr diff`, `gh pr view` and `gh pr edit`. */
const createFakeDollar = ({ diff = KOTLIN_DIFF, body = KOTLIN_BODY, state = 'OPEN', editCode = 0 } = {}) => {
  const calls = [];
  const edits = [];
  const $ = (first, ...values) => {
    if (!Array.isArray(first)) return $;
    const command = first.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ''), '');
    calls.push(command);
    if (command.startsWith('gh pr diff')) return Promise.resolve({ code: 0, stdout: diff, stderr: '' });
    if (command.startsWith('gh pr view')) return Promise.resolve({ code: 0, stdout: JSON.stringify([state, body]), stderr: '' });
    if (command.startsWith('gh pr edit')) {
      const bodyFile = values[values.length - 1];
      edits.push(fs.readFileSync(bodyFile, 'utf8'));
      return Promise.resolve({ code: editCode, stdout: '', stderr: editCode ? 'HTTP 422' : '' });
    }
    return Promise.resolve({ code: 1, stdout: '', stderr: `unexpected: ${command}` });
  };
  return { $, calls, edits };
};

console.log('Issue #2318: the PR description follows the diff; one cost for a free model; no quoted titles\n');

await test('the Kotlin body: the stale generated Changes section is replaced, everything else kept', () => {
  const next = replaceChangesSection(KOTLIN_BODY, STATS);
  assert.doesNotMatch(next, /1 file\(s\) modified/);
  assert.match(next, /- 3 file\(s\) modified/);
  assert.match(next, / {2}- `src\/main\/kotlin\/Main\.kt`/);
  assert.match(next, / {2}- `\.github\/workflows\/ci\.yml`/);
  assert.ok(next.startsWith('## Summary\n\nThis pull request implements a solution for #1: Implement Hello World in Kotlin\n\n<!-- hive-mind:changes:start -->\n### Changes\n'));
  assert.ok(next.includes(`${CHANGES_SECTION_END}\n\n### Issue Reference\nFixes #1\n\n${FOOTER}`), next);
  assert.equal(next.match(/### Changes/g).length, 1);
});

await test('the Rust placeholder sentence is a generated line too', () => {
  const next = replaceChangesSection(RUST_BODY, STATS);
  assert.doesNotMatch(next, /No files were changed/);
  assert.match(next, /### Issue Reference\nFixes #1/);
});

await test('a marked section is replaced in place and regeneration is idempotent', () => {
  const once = replaceChangesSection(KOTLIN_BODY, STATS);
  const moreStats = { ...STATS, filesChanged: 4, additions: 9, files: [...STATS.files, 'build.gradle.kts'] };
  const twice = replaceChangesSection(once, moreStats);
  assert.match(twice, /- 4 file\(s\) modified/);
  assert.match(twice, /`build\.gradle\.kts`/);
  assert.equal(twice.split(CHANGES_SECTION_START).length, 2, 'exactly one marked section');
  assert.equal(replaceChangesSection(twice, moreStats), twice);
});

await test('a human-written "### Changes" section is never touched', () => {
  const human = `Implements the Kotlin program.\n\n### Changes\n- Added \`Main.kt\` printing the greeting\n- Added a CI workflow\n\nFixes #1\n\n${FOOTER}`;
  const next = replaceChangesSection(human, STATS);
  assert.ok(next.includes('### Changes\n- Added `Main.kt` printing the greeting\n- Added a CI workflow\n'), 'human text kept verbatim');
  assert.ok(next.includes(`Fixes #1\n\n${formatChangesSection(STATS)}\n\n${FOOTER}`), 'generated section added above the footer');
});

await test('a body without a footer gets the section appended; an empty body gets only the section', () => {
  assert.equal(replaceChangesSection('Fixes #1', STATS), `Fixes #1\n\n${formatChangesSection(STATS)}\n`);
  assert.equal(replaceChangesSection('', STATS), `${formatChangesSection(STATS)}\n`);
});

await test('the file list is capped', () => {
  const files = Array.from({ length: 53 }, (_, index) => `f${index}.txt`);
  const section = formatChangesSection({ ...STATS, filesChanged: 53, files });
  assert.match(section, /`f49\.txt`/);
  assert.doesNotMatch(section, /`f50\.txt`/);
  assert.match(section, /…and 3 more/);
});

await test('getPullRequestChangeStats lists the changed paths', async () => {
  const { $ } = createFakeDollar();
  const stats = await getPullRequestChangeStats({ owner: 'o', repo: 'r', prNumber: 2, $ });
  assert.deepEqual(stats.files, ['src/main/kotlin/Main.kt', '.github/workflows/ci.yml', 'verify.sh']);
});

await test('refreshPullRequestChangesSection edits the Kotlin PR from its diff', async () => {
  const fake = createFakeDollar();
  const logs = [];
  const result = await refreshPullRequestChangesSection({ owner: 'o', repo: 'r', prNumber: 2, $: fake.$, log: async message => logs.push(message) });
  assert.equal(result.updated, true, result.reason);
  assert.equal(result.changeStats.filesChanged, 3);
  assert.equal(fake.edits.length, 1);
  assert.match(fake.edits[0], /- 3 file\(s\) modified\n- 6 line\(s\) added/);
  assert.match(fake.edits[0], /Fixes #1/);
  assert.ok(fake.calls.some(command => command.startsWith('gh pr edit 2 --repo o/r --body-file ')));
  assert.ok(logs.some(message => message.includes('Changes section regenerated')));
});

await test('an up-to-date, closed or unreadable PR is left alone', async () => {
  const current = replaceChangesSection(KOTLIN_BODY, STATS);
  const upToDate = createFakeDollar({ body: current });
  assert.equal((await refreshPullRequestChangesSection({ owner: 'o', repo: 'r', prNumber: 2, $: upToDate.$ })).reason, 'unchanged');
  assert.equal(upToDate.edits.length, 0);

  const merged = createFakeDollar({ state: 'MERGED' });
  assert.equal((await refreshPullRequestChangesSection({ owner: 'o', repo: 'r', prNumber: 2, $: merged.$ })).reason, 'not_open');
  assert.equal(merged.edits.length, 0);

  const unreadable = createFakeDollar();
  const result = await refreshPullRequestChangesSection({ owner: 'o', repo: 'r', prNumber: 2, $: unreadable.$, changeStats: { measured: false } });
  assert.equal(result.reason, 'diff_unavailable');
  assert.equal(unreadable.calls.length, 0);
});

await test('a failed edit is reported, not thrown', async () => {
  const fake = createFakeDollar({ editCode: 1 });
  const logs = [];
  const result = await refreshPullRequestChangesSection({ owner: 'o', repo: 'r', prNumber: 2, $: fake.$, log: async message => logs.push(message) });
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'edit_failed');
  assert.ok(logs.some(message => message.includes('HTTP 422')));
});

await test('both session ends regenerate the section, for every model', () => {
  const results = read('src/solve.results.lib.mjs');
  assert.match(results, /refreshPullRequestChangesSection\(\{ owner, repo, prNumber: pr\.number, \$, log \}\)/);
  assert.match(results, /\$\{formatChangesSection\(changeStats\)\}/, 'the placeholder body uses the marked section');
  const restart = read('src/solve.restart-shared.lib.mjs');
  const refreshAt = restart.indexOf('refreshPullRequestChangesSection({');
  assert.ok(refreshAt !== -1, 'restart iterations refresh the section');
  assert.ok(refreshAt < restart.indexOf("reason: 'restart iteration finished successfully'"), 'before the ready transition');
  for (const source of [results, restart]) {
    const around = source.slice(Math.max(0, source.indexOf('refreshPullRequestChangesSection({') - 400), source.indexOf('refreshPullRequestChangesSection({'));
    assert.doesNotMatch(around, /isFormalAiModel/, 'not gated on a model');
  }
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
