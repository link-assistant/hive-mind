#!/usr/bin/env node

/**
 * Tests for issue #1885:
 * --escalate / --escalate-from / --escalate-steps
 *
 * Covers the pure parsing/planning helpers (network-free) plus the CLI option
 * definitions and the config-level normalization/validation of the flags and
 * the initial-model override (start on the range's lower bound).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1885
 */

import assert from 'node:assert/strict';
import { MODEL_ESCALATION_ORDER, DEFAULT_ESCALATE_LOWER, DEFAULT_ESCALATE_UPPER, DEFAULT_ESCALATE_RANGE, DEFAULT_ESCALATE_STEPS, canonicalTier, parseEscalateRange, parseEscalateFrom, normalizeEscalateSteps, buildEscalationPlan, resolveEscalationModel, isEscalateEnabled, resolveEscalationConfig, formatEscalationPlan } from '../src/solve.escalate.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS, parseArguments } from '../src/solve.config.lib.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('model ladder is haiku < sonnet < opus < fable', () => {
  assert.deepEqual(MODEL_ESCALATION_ORDER, ['haiku', 'sonnet', 'opus', 'fable']);
});

test('defaults: range is sonnet-fable, steps is 1', () => {
  assert.equal(DEFAULT_ESCALATE_LOWER, 'sonnet');
  assert.equal(DEFAULT_ESCALATE_UPPER, 'fable');
  assert.equal(DEFAULT_ESCALATE_RANGE, 'sonnet-fable');
  assert.equal(DEFAULT_ESCALATE_STEPS, 1);
});

// ---------------------------------------------------------------------------
// canonicalTier
// ---------------------------------------------------------------------------

test('canonicalTier maps short names to themselves', () => {
  assert.equal(canonicalTier('haiku'), 'haiku');
  assert.equal(canonicalTier('sonnet'), 'sonnet');
  assert.equal(canonicalTier('opus'), 'opus');
  assert.equal(canonicalTier('fable'), 'fable');
});

test('canonicalTier maps aliases to tiers', () => {
  assert.equal(canonicalTier('opus-4-8'), 'opus');
  assert.equal(canonicalTier('claude-opus-4-8'), 'opus');
  assert.equal(canonicalTier('sonnet-4-6'), 'sonnet');
  assert.equal(canonicalTier('claude-fable-5'), 'fable');
  assert.equal(canonicalTier('claude-haiku-4-5-20251001'), 'haiku');
});

test('canonicalTier is case-insensitive and trims', () => {
  assert.equal(canonicalTier('  OPUS  '), 'opus');
  assert.equal(canonicalTier('Sonnet'), 'sonnet');
});

test('canonicalTier returns null for unknown/invalid input', () => {
  assert.equal(canonicalTier('gpt-4'), null);
  assert.equal(canonicalTier(''), null);
  assert.equal(canonicalTier(undefined), null);
  assert.equal(canonicalTier(42), null);
});

// ---------------------------------------------------------------------------
// parseEscalateRange
// ---------------------------------------------------------------------------

test('parseEscalateRange: bare flag (true) yields the default range', () => {
  assert.deepEqual(parseEscalateRange(true), { from: 'sonnet', to: 'fable' });
  assert.deepEqual(parseEscalateRange(undefined), { from: 'sonnet', to: 'fable' });
  assert.deepEqual(parseEscalateRange(''), { from: 'sonnet', to: 'fable' });
});

test('parseEscalateRange: two-part range', () => {
  assert.deepEqual(parseEscalateRange('sonnet-opus'), { from: 'sonnet', to: 'opus' });
  assert.deepEqual(parseEscalateRange('haiku-fable'), { from: 'haiku', to: 'fable' });
});

test('parseEscalateRange: single tier means just that tier', () => {
  assert.deepEqual(parseEscalateRange('opus'), { from: 'opus', to: 'opus' });
});

test('parseEscalateRange: rejects a reversed range', () => {
  assert.throws(() => parseEscalateRange('fable-sonnet'), /lower bound/);
  assert.throws(() => parseEscalateRange('opus-haiku'), /lower bound/);
});

test('parseEscalateRange: rejects dashed aliases inside a range (ambiguous)', () => {
  assert.throws(() => parseEscalateRange('opus-4-8'), /Invalid --escalate/);
});

test('parseEscalateRange: rejects unknown model names', () => {
  assert.throws(() => parseEscalateRange('gpt-fable'), /Invalid --escalate/);
});

// ---------------------------------------------------------------------------
// parseEscalateFrom
// ---------------------------------------------------------------------------

test('parseEscalateFrom: escalates from given tier up to fable', () => {
  assert.deepEqual(parseEscalateFrom('haiku'), { from: 'haiku', to: 'fable' });
  assert.deepEqual(parseEscalateFrom('sonnet'), { from: 'sonnet', to: 'fable' });
});

test('parseEscalateFrom: accepts aliases', () => {
  assert.deepEqual(parseEscalateFrom('opus-4-8'), { from: 'opus', to: 'fable' });
});

test('parseEscalateFrom: rejects unknown model', () => {
  assert.throws(() => parseEscalateFrom('gpt-4'), /Invalid --escalate-from/);
});

// ---------------------------------------------------------------------------
// normalizeEscalateSteps
// ---------------------------------------------------------------------------

test('normalizeEscalateSteps: default is 1', () => {
  assert.equal(normalizeEscalateSteps(undefined), 1);
  assert.equal(normalizeEscalateSteps(null), 1);
  assert.equal(normalizeEscalateSteps(''), 1);
});

test('normalizeEscalateSteps: positive integers honored', () => {
  assert.equal(normalizeEscalateSteps(2), 2);
  assert.equal(normalizeEscalateSteps('3'), 3);
});

test('normalizeEscalateSteps: rejects zero, negatives, fractions, non-numbers', () => {
  assert.throws(() => normalizeEscalateSteps(0), /positive integer/);
  assert.throws(() => normalizeEscalateSteps(-1), /positive integer/);
  assert.throws(() => normalizeEscalateSteps(1.5), /positive integer/);
  assert.throws(() => normalizeEscalateSteps('abc'), /positive integer/);
});

// ---------------------------------------------------------------------------
// buildEscalationPlan
// ---------------------------------------------------------------------------

test('buildEscalationPlan: default range, 1 step', () => {
  assert.deepEqual(buildEscalationPlan({ from: 'sonnet', to: 'fable', steps: 1 }), ['sonnet', 'opus', 'fable']);
});

test('buildEscalationPlan: default range, 2 steps repeats each tier', () => {
  assert.deepEqual(buildEscalationPlan({ from: 'sonnet', to: 'fable', steps: 2 }), ['sonnet', 'sonnet', 'opus', 'opus', 'fable', 'fable']);
});

test('buildEscalationPlan: single tier', () => {
  assert.deepEqual(buildEscalationPlan({ from: 'opus', to: 'opus', steps: 1 }), ['opus']);
});

test('buildEscalationPlan: full ladder', () => {
  assert.deepEqual(buildEscalationPlan({ from: 'haiku', to: 'fable', steps: 1 }), ['haiku', 'sonnet', 'opus', 'fable']);
});

test('buildEscalationPlan: rejects invalid bounds', () => {
  assert.throws(() => buildEscalationPlan({ from: 'fable', to: 'sonnet', steps: 1 }), /Invalid escalation bounds/);
});

// ---------------------------------------------------------------------------
// resolveEscalationModel
// ---------------------------------------------------------------------------

test('resolveEscalationModel: indexes into the plan and clamps to last', () => {
  const plan = ['sonnet', 'opus', 'fable'];
  assert.equal(resolveEscalationModel(plan, 0), 'sonnet');
  assert.equal(resolveEscalationModel(plan, 1), 'opus');
  assert.equal(resolveEscalationModel(plan, 2), 'fable');
  assert.equal(resolveEscalationModel(plan, 99), 'fable');
  assert.equal(resolveEscalationModel(plan, -5), 'sonnet');
});

test('resolveEscalationModel: empty plan yields undefined', () => {
  assert.equal(resolveEscalationModel([], 0), undefined);
});

// ---------------------------------------------------------------------------
// isEscalateEnabled / resolveEscalationConfig
// ---------------------------------------------------------------------------

test('isEscalateEnabled reflects escalate / escalateFrom', () => {
  assert.equal(isEscalateEnabled({}), false);
  assert.equal(isEscalateEnabled({ escalate: 'sonnet-fable' }), true);
  assert.equal(isEscalateEnabled({ escalateFrom: 'haiku' }), true);
  assert.equal(isEscalateEnabled(null), false);
});

test('resolveEscalationConfig: disabled yields null', () => {
  assert.equal(resolveEscalationConfig({}), null);
});

test('resolveEscalationConfig: --escalate range', () => {
  assert.deepEqual(resolveEscalationConfig({ escalate: 'sonnet-fable', escalateSteps: 1 }), {
    enabled: true,
    from: 'sonnet',
    to: 'fable',
    steps: 1,
    plan: ['sonnet', 'opus', 'fable'],
  });
});

test('resolveEscalationConfig: --escalate-from takes precedence over --escalate', () => {
  const config = resolveEscalationConfig({ escalate: 'sonnet-opus', escalateFrom: 'haiku', escalateSteps: 1 });
  assert.equal(config.from, 'haiku');
  assert.equal(config.to, 'fable');
});

test('resolveEscalationConfig: steps repeats each tier', () => {
  const config = resolveEscalationConfig({ escalate: 'sonnet-fable', escalateSteps: 2 });
  assert.deepEqual(config.plan, ['sonnet', 'sonnet', 'opus', 'opus', 'fable', 'fable']);
});

// ---------------------------------------------------------------------------
// formatEscalationPlan
// ---------------------------------------------------------------------------

test('formatEscalationPlan: collapses repeats', () => {
  assert.equal(formatEscalationPlan(['sonnet', 'opus', 'fable']), 'sonnet → opus → fable');
  assert.equal(formatEscalationPlan(['sonnet', 'sonnet', 'opus', 'opus']), 'sonnet×2 → opus×2');
  assert.equal(formatEscalationPlan([]), '(empty)');
});

// ---------------------------------------------------------------------------
// CLI option definitions
// ---------------------------------------------------------------------------

test('--escalate option is defined as a string', () => {
  const def = SOLVE_OPTION_DEFINITIONS['escalate'];
  assert.ok(def, 'option must be defined');
  assert.equal(def.type, 'string');
});

test('--escalate-from option is defined as a string', () => {
  const def = SOLVE_OPTION_DEFINITIONS['escalate-from'];
  assert.ok(def, 'option must be defined');
  assert.equal(def.type, 'string');
});

test('--escalate-steps option is defined as a number defaulting to 1', () => {
  const def = SOLVE_OPTION_DEFINITIONS['escalate-steps'];
  assert.ok(def, 'option must be defined');
  assert.equal(def.type, 'number');
  assert.equal(def.default, 1);
});

// ---------------------------------------------------------------------------
// CLI integration (parseArguments)
// ---------------------------------------------------------------------------

const parseWith = async extraArgs => {
  const saved = process.argv;
  try {
    process.argv = ['node', 'solve.mjs', 'https://github.com/o/r/issues/1', ...extraArgs];
    return await parseArguments();
  } finally {
    process.argv = saved;
  }
};

test('CLI: bare --escalate normalizes to the default range and sets model to lower bound', async () => {
  const argv = await parseWith(['--escalate']);
  assert.equal(argv.escalate, 'sonnet-fable');
  const config = resolveEscalationConfig(argv);
  assert.deepEqual(config.plan, ['sonnet', 'opus', 'fable']);
  // Initial solve session should start on the cheapest tier in the plan.
  assert.equal(argv.model, 'sonnet');
});

test('CLI: --escalate=sonnet-opus sets bounds and starts on sonnet', async () => {
  const argv = await parseWith(['--escalate=sonnet-opus']);
  assert.equal(argv.escalate, 'sonnet-opus');
  const config = resolveEscalationConfig(argv);
  assert.deepEqual(config.plan, ['sonnet', 'opus']);
  assert.equal(argv.model, 'sonnet');
});

test('CLI: --escalate-from=haiku escalates up to fable and starts on haiku', async () => {
  const argv = await parseWith(['--escalate-from=haiku']);
  const config = resolveEscalationConfig(argv);
  assert.equal(config.from, 'haiku');
  assert.equal(config.to, 'fable');
  assert.equal(argv.model, 'haiku');
});

test('CLI: --escalate-steps=2 is parsed as a number', async () => {
  const argv = await parseWith(['--escalate', '--escalate-steps=2']);
  assert.equal(argv.escalateSteps, 2);
  const config = resolveEscalationConfig(argv);
  assert.deepEqual(config.plan, ['sonnet', 'sonnet', 'opus', 'opus', 'fable', 'fable']);
});

test('CLI: explicit --model wins over the escalate lower-bound override', async () => {
  const argv = await parseWith(['--escalate=sonnet-fable', '--model', 'opus']);
  // User pinned the worker model explicitly; escalate must not override it.
  assert.equal(argv.model, 'opus');
});

test('CLI: flag absent leaves escalate disabled', async () => {
  const argv = await parseWith([]);
  assert.equal(isEscalateEnabled(argv), false);
});

test('CLI: invalid --escalate range fails fast at config time', async () => {
  await assert.rejects(async () => parseWith(['--escalate=fable-sonnet']));
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`All ${passed} issue #1885 escalate tests passed.`);
