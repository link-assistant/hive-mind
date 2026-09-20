#!/usr/bin/env node
// Issue #2038: canonical --think normalization (synonyms, minimal, adaptive,
// percentages/fractions/0|1) and adaptive support validation.

import assert from 'node:assert';
import { normalizeThinkLevel, fractionToThinkLevel, parseNumericThinkValue, CANONICAL_THINK_LEVELS } from '../src/think-level.lib.mjs';
import { thinkLevelToEffortLevel, getThinkingLevelToTokens, supportsAdaptiveThinking } from '../src/config.lib.mjs';
import { resolveCodexReasoningEffort } from '../src/codex.options.lib.mjs';

// --- Off synonyms all fold to 'off' ---
for (const syn of ['off', 'OFF', 'disable', 'Disabled', 'no', 'none', 'false', ' none ']) {
  assert.equal(normalizeThinkLevel(syn), 'off', `"${syn}" must normalize to off`);
}

// --- Keyword levels pass through, including new minimal and adaptive ---
assert.equal(normalizeThinkLevel('minimal'), 'minimal');
assert.equal(normalizeThinkLevel('min'), 'minimal');
assert.equal(normalizeThinkLevel('adaptive'), 'adaptive');
assert.equal(normalizeThinkLevel('auto'), 'adaptive');
for (const lvl of ['low', 'medium', 'high', 'xhigh', 'ultra', 'max']) {
  assert.equal(normalizeThinkLevel(lvl), lvl);
}

// --- Empty/undefined stays undefined ---
assert.equal(normalizeThinkLevel(undefined), undefined);
assert.equal(normalizeThinkLevel(''), undefined);

// --- Percentages ---
assert.equal(normalizeThinkLevel('0%'), 'off');
assert.equal(normalizeThinkLevel('100%'), 'max');
assert.equal(normalizeThinkLevel('50%'), 'medium');
assert.equal(normalizeThinkLevel('10%'), 'minimal');

// --- Fractions ---
assert.equal(normalizeThinkLevel('0.0'), 'off');
assert.equal(normalizeThinkLevel('1.0'), 'max');
assert.equal(normalizeThinkLevel('0.5'), 'medium');
assert.equal(normalizeThinkLevel('0.1'), 'minimal');

// --- Integer endpoints 0 and 1 ---
assert.equal(normalizeThinkLevel('0'), 'off');
assert.equal(normalizeThinkLevel('1'), 'max');
assert.equal(normalizeThinkLevel(0), 'off');
assert.equal(normalizeThinkLevel(1), 'max');

// --- Bare integers > 1 treated as percentage ---
assert.equal(normalizeThinkLevel('50'), 'medium');
assert.equal(normalizeThinkLevel(75), 'high');

// --- Invalid values throw ---
assert.throws(() => normalizeThinkLevel('bogus'), /Invalid --think value/);
assert.throws(() => normalizeThinkLevel('-5'), /Invalid --think value/); // '-' not matched → throws

// --- fraction helper edge cases ---
assert.equal(fractionToThinkLevel(0), 'off');
assert.equal(fractionToThinkLevel(1), 'max');
assert.equal(fractionToThinkLevel(1.5), 'max');
assert.equal(parseNumericThinkValue('abc'), null);

// --- minimal maps across tools ---
// Codex: minimal → native minimal reasoning effort
assert.deepEqual(resolveCodexReasoningEffort({ think: 'minimal' }), { reasoningEffort: 'minimal', source: '--think minimal' });
// Claude effort: minimal → lowest real effort (low)
assert.equal(thinkLevelToEffortLevel('minimal', { supportsXHigh: true, supportsMax: true }), 'low');
// Claude token budget: minimal sits below low
const tokens = getThinkingLevelToTokens(31999);
assert.ok(tokens.minimal > 0 && tokens.minimal < tokens.low, 'minimal budget must be between 0 and low');

// --- adaptive effort is unset (provider-managed) ---
assert.equal(thinkLevelToEffortLevel('adaptive', { supportsXHigh: true, supportsMax: true }), undefined);

// --- adaptive support gating ---
assert.equal(supportsAdaptiveThinking('opus'), true); // Opus 4.8 default alias resolves adaptive
assert.equal(supportsAdaptiveThinking('sonnet'), true);
assert.equal(supportsAdaptiveThinking('opus-4-5'), false);
assert.equal(supportsAdaptiveThinking(''), false);

// --- canonical level set sanity ---
assert.ok(CANONICAL_THINK_LEVELS.includes('minimal'));
assert.ok(!CANONICAL_THINK_LEVELS.includes('adaptive'), 'adaptive is a separate mode, not on the intensity ladder');

console.log('Issue #2038 think normalization tests passed.');
