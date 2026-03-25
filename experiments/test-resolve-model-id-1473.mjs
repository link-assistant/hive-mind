#!/usr/bin/env node
/**
 * Experiment: Test resolveModelId fix for Issue #1473
 *
 * Verifies that resolveModelId correctly resolves agent free model aliases
 * to their full model IDs (with provider prefix), which is required for
 * doesRequestedMatchActual() to work correctly.
 *
 * Before the fix, resolveModelId('kimi-k2.5-free', 'agent') returned 'kimi-k2.5-free'
 * After the fix, it returns 'opencode/kimi-k2.5-free'
 */

import { resolveModelId } from '../src/model-info.lib.mjs';

const testCases = [
  // Agent free models - these were broken before the fix
  { model: 'kimi-k2.5-free', tool: 'agent', expected: 'opencode/kimi-k2.5-free' },
  { model: 'minimax-m2.5-free', tool: 'agent', expected: 'opencode/minimax-m2.5-free' },
  { model: 'big-pickle', tool: 'agent', expected: 'opencode/big-pickle' },
  { model: 'gpt-5-nano', tool: 'agent', expected: 'opencode/gpt-5-nano' },
  { model: 'glm-5-free', tool: 'agent', expected: 'kilo/glm-5-free' },
  { model: 'deepseek-r1-free', tool: 'agent', expected: 'kilo/deepseek-r1-free' },
  // Agent premium models (already worked)
  { model: 'sonnet', tool: 'agent', expected: 'anthropic/claude-3-5-sonnet' },
  { model: 'opus', tool: 'agent', expected: 'anthropic/claude-3-opus' },
  // Claude models
  { model: 'sonnet', tool: 'claude', expected: 'claude-sonnet-4-6' },
  { model: 'opus', tool: 'claude', expected: 'claude-opus-4-6' },
  // Full IDs should pass through
  { model: 'opencode/minimax-m2.5-free', tool: 'agent', expected: 'opencode/minimax-m2.5-free' },
  { model: 'kilo/glm-5-free', tool: 'agent', expected: 'kilo/glm-5-free' },
];

let passed = 0;
let failed = 0;

for (const { model, tool, expected } of testCases) {
  const result = resolveModelId(model, tool);
  const ok = result === expected;
  if (ok) {
    passed++;
    console.log(`  ✅ resolveModelId('${model}', '${tool}') => '${result}'`);
  } else {
    failed++;
    console.log(`  ❌ resolveModelId('${model}', '${tool}') => '${result}' (expected '${expected}')`);
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${testCases.length} tests`);
process.exit(failed > 0 ? 1 : 0);
