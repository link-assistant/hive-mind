#!/usr/bin/env node

/**
 * Unit tests for Issue #1486: Filtering <synthetic> model entries
 *
 * Tests that internal/synthetic model entries from Claude CLI's inference router
 * are properly filtered out from:
 * 1. JSONL session token calculation (calculateSessionTokens)
 * 2. Actual model IDs list used for PR comments (attachLogToGitHub)
 */

import assert from 'node:assert';

// ─── Test 1: Synthetic model filter in JSONL parsing ───

// Simulate the filter logic from calculateSessionTokens() in claude.lib.mjs
const parseModelUsageFromLines = lines => {
  const modelUsage = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.message && entry.message.usage && entry.message.model) {
        const model = entry.message.model;
        // Issue #1486: Skip internal/synthetic model entries
        if (model === '<synthetic>' || (model.startsWith('<') && model.endsWith('>'))) {
          continue;
        }
        const usage = entry.message.usage;
        if (!modelUsage[model]) {
          modelUsage[model] = { inputTokens: 0, outputTokens: 0 };
        }
        if (usage.input_tokens) modelUsage[model].inputTokens += usage.input_tokens;
        if (usage.output_tokens) modelUsage[model].outputTokens += usage.output_tokens;
      }
    } catch {
      continue;
    }
  }
  return modelUsage;
};

// Test data simulating JSONL lines from a Claude session
const testLines = [
  JSON.stringify({ message: { model: 'claude-opus-4-6', usage: { input_tokens: 100, output_tokens: 50 } } }),
  JSON.stringify({ message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } }),
  JSON.stringify({ message: { model: 'claude-opus-4-6', usage: { input_tokens: 200, output_tokens: 75 } } }),
  JSON.stringify({ message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } }),
];

const modelUsage = parseModelUsageFromLines(testLines);

console.log('Test 1: Synthetic model filtered from JSONL parsing');
assert.deepStrictEqual(Object.keys(modelUsage), ['claude-opus-4-6'], 'Should only contain claude-opus-4-6');
assert.strictEqual(modelUsage['claude-opus-4-6'].inputTokens, 300, 'Input tokens should be summed correctly');
assert.strictEqual(modelUsage['claude-opus-4-6'].outputTokens, 125, 'Output tokens should be summed correctly');
assert.strictEqual(modelUsage['<synthetic>'], undefined, '<synthetic> should not exist in modelUsage');
console.log('  ✅ Passed');

// ─── Test 2: Other angle-bracket models also filtered ───

console.log('Test 2: Other angle-bracket internal models filtered');
const testLines2 = [
  JSON.stringify({ message: { model: 'claude-opus-4-6', usage: { input_tokens: 100, output_tokens: 50 } } }),
  JSON.stringify({ message: { model: '<internal>', usage: { input_tokens: 0, output_tokens: 0 } } }),
  JSON.stringify({ message: { model: '<router>', usage: { input_tokens: 5, output_tokens: 3 } } }),
];

const modelUsage2 = parseModelUsageFromLines(testLines2);
assert.deepStrictEqual(Object.keys(modelUsage2), ['claude-opus-4-6'], 'Should filter all <...> models');
console.log('  ✅ Passed');

// ─── Test 3: actualModelIds filter in github.lib.mjs ───

// Simulate the filter logic from attachLogToGitHub()
const filterModelIds = ids => {
  if (!ids) return null;
  const filtered = ids.filter(id => !(id.startsWith('<') && id.endsWith('>')));
  return filtered.length === 0 ? null : filtered;
};

console.log('Test 3: actualModelIds filter removes synthetic models');
assert.deepStrictEqual(
  filterModelIds(['claude-opus-4-6', '<synthetic>']),
  ['claude-opus-4-6'],
  'Should remove <synthetic> from model IDs',
);
console.log('  ✅ Passed');

console.log('Test 4: actualModelIds filter with only synthetic returns null');
assert.strictEqual(filterModelIds(['<synthetic>']), null, 'Should return null when only synthetic models');
console.log('  ✅ Passed');

console.log('Test 5: actualModelIds filter with null input returns null');
assert.strictEqual(filterModelIds(null), null, 'Should return null for null input');
console.log('  ✅ Passed');

console.log('Test 6: actualModelIds filter with no synthetic models passes through');
assert.deepStrictEqual(
  filterModelIds(['claude-opus-4-6', 'claude-haiku-4-5-20251001']),
  ['claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  'Should keep all real model IDs',
);
console.log('  ✅ Passed');

// ─── Test 7: Real-world scenario from issue #1486 ───

console.log('Test 7: Real-world scenario from issue #1486 log');
const realWorldLines = [
  // Simulated entries matching the actual session data pattern
  JSON.stringify({
    message: {
      model: 'claude-opus-4-6',
      usage: { input_tokens: 10, cache_creation_input_tokens: 7212, cache_read_input_tokens: 11150, output_tokens: 1500 },
    },
  }),
  JSON.stringify({
    message: {
      model: '<synthetic>',
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }),
  JSON.stringify({
    message: {
      model: 'claude-opus-4-6',
      usage: { input_tokens: 5, cache_creation_input_tokens: 6028, cache_read_input_tokens: 18362, output_tokens: 800 },
    },
  }),
];

const realWorldUsage = parseModelUsageFromLines(realWorldLines);
assert.deepStrictEqual(Object.keys(realWorldUsage), ['claude-opus-4-6'], 'Real-world: should only have claude-opus-4-6');
assert.strictEqual(realWorldUsage['claude-opus-4-6'].inputTokens, 15, 'Real-world: input tokens summed correctly');
assert.strictEqual(realWorldUsage['claude-opus-4-6'].outputTokens, 2300, 'Real-world: output tokens summed correctly');
console.log('  ✅ Passed');

console.log('\n✅ All 7 tests passed!');
