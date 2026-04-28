#!/usr/bin/env node

/**
 * Unit tests for displayCostComparison terminal output (Issue #1557, #1703).
 *
 * displayCostComparison renders the cost summary in the live console / log file
 * (see src/claude.budget-stats.lib.mjs). It mirrors buildCostInfoString and
 * therefore must collapse to the short form whenever the public and Anthropic
 * costs agree to within display precision (Issue #1703).
 *
 * @hive-mind-test-suite default
 */

import { displayCostComparison } from '../src/claude.budget-stats.lib.mjs';

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

async function captureOutput(publicCost, anthropicCost) {
  const lines = [];
  await displayCostComparison(publicCost, anthropicCost, async msg => lines.push(msg));
  return lines.join('\n');
}

console.log('🧪 Running displayCostComparison unit tests (Issues #1557 & #1703)...\n');
console.log('='.repeat(80));

await runTest('shows simplified format when costs match exactly (Issue #1557)', async () => {
  const output = await captureOutput(5.207635, 5.207635);
  assertEqual(output, '\n   💰 Cost: $5.207635', 'Should print single-line cost summary');
});

await runTest('shows full breakdown when costs differ by exactly $0.000001', async () => {
  const output = await captureOutput(5.207635, 5.207636);
  assertContains(output, '💰 Cost estimation:', 'Should print full estimation header');
  assertContains(output, 'Public pricing estimate: $5.207635', 'Should show public pricing line');
  assertContains(output, 'Calculated by Anthropic: $5.207636', 'Should show Anthropic line');
  assertContains(output, 'Difference:', 'Should show difference line at 1e-6 precision');
});

await runTest('collapses to simplified format when difference rounds to zero (Issue #1703)', async () => {
  // Real-world numbers from Issue #1703 (gist log): displays differ at toFixed(6)
  // (11.219694 vs 11.219693) but the actual difference rounds to $-0.000000.
  const output = await captureOutput(11.21969355, 11.21969345);
  assertEqual(output, '\n   💰 Cost: $11.219693', 'Should collapse for sub-precision difference');
  assertNotContains(output, 'Difference', 'Should not show the meaningless $-0.000000 line');
  assertNotContains(output, 'Public pricing estimate', 'Should not show two-line breakdown');
});

await runTest('still shows full breakdown when only one cost is known', async () => {
  const onlyPublic = await captureOutput(1.234567, null);
  assertContains(onlyPublic, 'Public pricing estimate: $1.234567', 'Should show public estimate');
  assertContains(onlyPublic, 'Calculated by Anthropic: unknown', 'Should mark Anthropic as unknown');

  const onlyAnthropic = await captureOutput(null, 1.234567);
  assertContains(onlyAnthropic, 'Public pricing estimate: unknown', 'Should mark public as unknown');
  assertContains(onlyAnthropic, 'Calculated by Anthropic: $1.234567', 'Should show Anthropic estimate');
});

console.log('\n' + '='.repeat(80));
console.log(`Test Results for displayCostComparison (Issues #1557 & #1703):`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(80));

process.exit(testsFailed > 0 ? 1 : 0);
