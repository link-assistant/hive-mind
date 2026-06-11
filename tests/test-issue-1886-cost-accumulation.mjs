#!/usr/bin/env node

/**
 * Issue #1886: "Calculation of cost has difference".
 *
 * Reproduces the reported scope mismatch and proves the fix.
 *
 * Root cause (proven below from the real gist numbers): the "Public pricing
 * estimate" is computed from the session JSONL, which accumulates the ENTIRE
 * session across limit-reset resumes (run1 that hit the limit + the resumed
 * run2). The "Calculated by Anthropic" figure comes from the result event's
 * `total_cost_usd`, which is scoped to a SINGLE Claude process (run2 only).
 * Comparing a full-session estimate against a single-run figure produced the
 * misleading "-31.66%" difference even though BOTH numbers are individually
 * correct for their scope.
 *
 * The fix (src/anthropic-cost-accumulator.lib.mjs): accumulate Anthropic's
 * per-process cost across resume iterations so the displayed figure shares the
 * full-session scope of the public estimate. The accumulation is model-agnostic
 * (it sums dollar amounts, never inspecting per-token prices).
 *
 * @hive-mind-test-suite default
 */

import { calculateModelCost } from '../src/claude.cost.lib.mjs';
import { displayCostComparison } from '../src/claude.budget-stats.lib.mjs';
import { seedCumulativeAnthropicCost, addAnthropicRunCost, getCumulativeAnthropicCost, hasCumulativeAnthropicCost, resetCumulativeAnthropicCost } from '../src/anthropic-cost-accumulator.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  return Promise.resolve()
    .then(testFn)
    .then(() => {
      console.log('✅ PASSED');
      testsPassed++;
    })
    .catch(error => {
      console.log(`❌ FAILED: ${error.message}`);
      testsFailed++;
    });
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`);
  }
}

function assertContains(str, substring, message = '') {
  if (!str.includes(substring)) {
    throw new Error(`${message}\nExpected string to contain: "${substring}"\nActual string: "${str}"`);
  }
}

function assertNotContains(str, substring, message = '') {
  if (str.includes(substring)) {
    throw new Error(`${message}\nExpected string NOT to contain: "${substring}"\nActual string: "${str}"`);
  }
}

// Fable 5 public pricing (per million tokens), from models.dev — the model used
// in the issue #1886 gist run.
const FABLE5 = { cost: { input: 10, cache_write: 12.5, cache_read: 1, output: 50 } };

// Real numbers from the issue #1886 gist log.
// result event modelUsage (claude-fable-5) — single resumed process (run2):
const RESULT_SCOPE = { inputTokens: 31490, cacheCreationTokens: 341700, cacheReadTokens: 13211220, outputTokens: 137297 };
// Final "Token Usage Summary" totals from the JSONL — the FULL session (run1 + run2):
const FULL_SCOPE = { inputTokens: 45265, cacheCreationTokens: 791087, cacheReadTokens: 16444028, outputTokens: 185995 };

const ANTHROPIC_REPORTED = 24.66222; // total_cost_usd from the result event
const PUBLIC_ESTIMATE = 36.085016; // "Public pricing estimate" from the summary

console.log('🧪 Running issue #1886 cost-accumulation tests...\n');
console.log('='.repeat(80));

async function captureCostComparison(publicCost, anthropicCost, options) {
  const lines = [];
  // Logger records verbose lines too, so the accumulation breakdown is visible.
  await displayCostComparison(publicCost, anthropicCost, async msg => lines.push(msg), options);
  return lines.join('\n');
}

// --- Part 1: reproduce the reported discrepancy from real token counts -------

await runTest('result-event token scope reproduces Anthropic figure ($24.662220)', () => {
  const cost = calculateModelCost(RESULT_SCOPE, FABLE5);
  assertEqual(cost.toFixed(6), ANTHROPIC_REPORTED.toFixed(6), 'Per-process tokens × Fable5 prices must equal Anthropic total_cost_usd');
});

await runTest('full-session JSONL token scope reproduces public estimate ($36.085016)', () => {
  const cost = calculateModelCost(FULL_SCOPE, FABLE5);
  // Matches to the displayed 6-decimal precision (last ULP differs by rounding).
  assertEqual(cost.toFixed(5), PUBLIC_ESTIMATE.toFixed(5), 'Full-session tokens × Fable5 prices must equal the public estimate');
});

await runTest('the -31.66% difference is a scope mismatch, not a pricing error', () => {
  const resultCost = calculateModelCost(RESULT_SCOPE, FABLE5);
  const fullCost = calculateModelCost(FULL_SCOPE, FABLE5);
  const pct = ((resultCost - fullCost) / fullCost) * 100;
  assertEqual(pct.toFixed(2), '-31.66', 'Comparing single-run Anthropic cost vs full-session public estimate reproduces the exact reported gap');
});

// --- Part 2: the accumulator module ------------------------------------------

await runTest('seed is applied exactly once per process (idempotent)', () => {
  resetCumulativeAnthropicCost();
  assertEqual(seedCumulativeAnthropicCost(11.42), 11.42, 'First seed sets the carried-forward total');
  assertEqual(seedCumulativeAnthropicCost(99.99), 11.42, 'Subsequent seeds are no-ops (in-process auto-merge loop)');
});

await runTest('addAnthropicRunCost accumulates across iterations', () => {
  resetCumulativeAnthropicCost();
  seedCumulativeAnthropicCost(0);
  assertEqual(addAnthropicRunCost(10), 10, 'first run');
  assertEqual(addAnthropicRunCost(5.5), 15.5, 'second run accumulates');
  assertEqual(getCumulativeAnthropicCost(), 15.5, 'getter returns running total');
});

await runTest('non-positive / non-finite run costs contribute nothing', () => {
  resetCumulativeAnthropicCost();
  seedCumulativeAnthropicCost(0);
  addAnthropicRunCost(null); // limit hit before a success result — no cost reported
  addAnthropicRunCost(undefined);
  addAnthropicRunCost(-3);
  addAnthropicRunCost(NaN);
  addAnthropicRunCost('not a number');
  assertEqual(getCumulativeAnthropicCost(), 0, 'Garbage inputs never corrupt the total');
  assertEqual(hasCumulativeAnthropicCost(), false, 'No positive cost yet');
});

await runTest('seed sanitizes invalid carried-forward values to 0', () => {
  resetCumulativeAnthropicCost();
  assertEqual(seedCumulativeAnthropicCost('garbage'), 0, 'Invalid --previous-anthropic-cost becomes 0');
  resetCumulativeAnthropicCost();
  assertEqual(seedCumulativeAnthropicCost(-5), 0, 'Negative --previous-anthropic-cost becomes 0');
});

// --- Part 3: the fix closes the gap on a cross-process resume ----------------

await runTest('accumulation makes the resumed-run Anthropic figure match the full-session estimate', () => {
  const resultCost = calculateModelCost(RESULT_SCOPE, FABLE5); // run2 (resumed process)
  const fullCost = calculateModelCost(FULL_SCOPE, FABLE5); // full session, public estimate
  const run1Cost = fullCost - resultCost; // run1's cost (hit the limit, then spawned run2)

  // run1 finished and folded its cost into the accumulator, then spawned run2
  // with --previous-anthropic-cost <run1Cost>. run2 seeds from that and adds its
  // own cost.
  resetCumulativeAnthropicCost();
  seedCumulativeAnthropicCost(run1Cost);
  const cumulative = addAnthropicRunCost(resultCost);

  assertEqual(cumulative.toFixed(6), fullCost.toFixed(6), 'Cumulative Anthropic cost equals the full-session public estimate');
});

await runTest('limit-hit run1 cost (non-success result fallback) is still carried forward', () => {
  // In the reported scenario run1 hit the usage limit and ended as is_error, so
  // no `success` result event fired. claude.lib.mjs folds `successCost ??
  // nonSuccessResultCost` into the accumulator on the failure path, so run1's
  // cost is captured from the non-success terminal result and carried into run2.
  const resultCost = calculateModelCost(RESULT_SCOPE, FABLE5); // run2 success cost
  const fullCost = calculateModelCost(FULL_SCOPE, FABLE5);
  const run1Cost = fullCost - resultCost; // reported only on run1's non-success result

  // run1: no success cost, fallback present → fold the fallback.
  resetCumulativeAnthropicCost();
  seedCumulativeAnthropicCost(0);
  const successCostRun1 = null;
  const nonSuccessResultCostRun1 = run1Cost;
  const run1Folded = addAnthropicRunCost(successCostRun1 ?? nonSuccessResultCostRun1);
  assertEqual(run1Folded.toFixed(6), run1Cost.toFixed(6), 'run1 folds its non-success result cost');

  // run2: seeded from run1's carried-forward cost, then adds its own success cost.
  resetCumulativeAnthropicCost();
  seedCumulativeAnthropicCost(run1Folded);
  const cumulative = addAnthropicRunCost(resultCost);
  assertEqual(cumulative.toFixed(6), fullCost.toFixed(6), 'Cumulative matches the full-session public estimate even when run1 hit the limit');
});

// --- Part 4: display integration ---------------------------------------------

await runTest('displayCostComparison collapses to the short form once accumulated (matches estimate)', async () => {
  const fullCost = calculateModelCost(FULL_SCOPE, FABLE5);
  const output = await captureCostComparison(fullCost, fullCost, { previousAnthropicCost: 11.42 });
  assertContains(output, '💰 Cost: $36.08501', 'Accumulated Anthropic cost matches the public estimate → single-line form');
  assertNotContains(output, '-31.66%', 'The misleading scope-mismatch percentage is gone');
});

await runTest('displayCostComparison shows the verbose accumulation breakdown', async () => {
  const output = await captureCostComparison(36.085015, 36.085015, { previousAnthropicCost: 11.422795 });
  assertContains(output, 'cumulative across resume iterations', 'Explains the accumulation in verbose mode');
  assertContains(output, 'carried forward: $11.422795', 'Shows the carried-forward portion');
});

await runTest('without accumulation (single fresh run) behaviour is unchanged', async () => {
  // previousAnthropicCost defaults to 0 → no breakdown line, normal rendering.
  const output = await captureCostComparison(5.207635, 5.207635);
  assertEqual(output, '\n   💰 Cost: $5.207635', 'Fresh-run rendering is byte-for-byte unchanged');
  assertNotContains(output, 'cumulative across resume iterations', 'No accumulation note for a fresh run');
});

resetCumulativeAnthropicCost();

console.log('\n' + '='.repeat(80));
console.log('Test Results for issue #1886 (cost accumulation across resumes):');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(80));

process.exit(testsFailed > 0 ? 1 : 0);
