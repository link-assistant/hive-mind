#!/usr/bin/env node

/**
 * Regression tests for Issue #1590: Split sub-agent usage stats per call
 *
 * When a working session contains multiple sub-agent calls (Agent tool invocations),
 * the token usage stats should show:
 * 1. The number of sub-agent calls per model
 * 2. A list of each individual sub-agent call with description and estimated usage
 * 3. Output percentage should not be misleading (e.g., 530% across 12 calls)
 */

import { buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';

// Test framework
let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\u2705 PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`\u274c FAILED: ${error.message}`);
    testsFailed++;
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

// Helper: create multi-model token usage data matching the issue scenario
// Opus as main agent, Sonnet as sub-agent with multiple calls
function makeIssueScenarioData() {
  return {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 65400,
        cacheCreationTokens: 0,
        cacheReadTokens: 2800000,
        outputTokens: 18400,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 74400,
        costUSD: 2.252598,
      },
      'claude-sonnet-4-6': {
        inputTokens: 681400,
        cacheCreationTokens: 0,
        cacheReadTokens: 3900000,
        outputTokens: 338900,
        modelName: 'Claude Sonnet 4.6',
        modelInfo: { limit: { context: 1000000, output: 64000 } },
        peakContextUsage: 0, // Sub-agent models typically have 0 peak context (from result JSON)
        costUSD: 8.806153,
      },
    },
    subSessions: [],
    inputTokens: 746800,
    cacheCreationTokens: 0,
    cacheReadTokens: 6700000,
    outputTokens: 357300,
    totalTokens: 1104100,
  };
}

// Helper: create sub-agent calls array (12 calls like in the issue scenario)
function makeSubAgentCalls(count = 12) {
  const calls = [];
  for (let i = 0; i < count; i++) {
    calls.push({
      id: `toolu_${i}`,
      description: `Sub-agent task ${i + 1}`,
      model: 'sonnet',
    });
  }
  return calls;
}

console.log('\n📋 Issue #1590: Sub-agent per-call stats tests\n');

// ==== Test: Without sub-agent calls (backward compatibility) ====

runTest('buildBudgetStatsString without subAgentCalls (backward compat)', () => {
  const tokenUsage = makeIssueScenarioData();
  const result = buildBudgetStatsString(tokenUsage);
  assertContains(result, 'Claude Opus 4.6', 'Should show Opus model name');
  assertContains(result, 'Claude Sonnet 4.6', 'Should show Sonnet model name');
  assertNotContains(result, 'sub-agent calls', 'Should not show sub-agent call count without data');
  assertNotContains(result, 'Sub-agent calls:', 'Should not show sub-agent call list without data');
  // When no sub-agent calls info, output percentage is still shown (backward compat)
  assertContains(result, '530%', 'Should show output percentage without sub-agent info');
});

// ==== Test: With sub-agent calls ====

runTest('buildBudgetStatsString with subAgentCalls shows call count', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCalls(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertContains(result, '12 sub-agent calls', 'Should show sub-agent call count');
});

runTest('buildBudgetStatsString with subAgentCalls shows individual call list', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCalls(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertContains(result, 'Sub-agent calls:', 'Should show sub-agent calls section header');
  // Each call should be listed individually with its description
  for (let i = 1; i <= 12; i++) {
    assertContains(result, `"Sub-agent task ${i}"`, `Should list sub-agent call ${i} with its description`);
  }
});

runTest('buildBudgetStatsString with subAgentCalls hides misleading output percentage on Total line', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCalls(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  // The Total line for Sonnet should NOT show 530% anymore
  // Split by model sections
  const sonnetSection = result.split('Claude Sonnet')[1] || '';
  assertNotContains(sonnetSection.split('\n\n')[0], '530%', 'Sonnet Total line should not show misleading 530% percentage');
});

runTest('buildBudgetStatsString sub-agent call list shows estimate note with upstream link', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCalls(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertContains(result, 'Per-call values are estimates', 'Should show estimate disclaimer');
  assertContains(result, 'upstream support', 'Should link to upstream issue');
});

runTest('buildBudgetStatsString sub-agent call list shows estimated cost per call', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCalls(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  // Cost per call: 8.806153 / 12 ≈ 0.733846
  assertContains(result, '~$0.733846', 'Should show per-call cost estimate');
});

runTest('buildBudgetStatsString main model (Opus) not affected by sub-agent calls', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCalls(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  // Opus section should not mention sub-agent calls
  const opusSection = result.split('Claude Sonnet')[0];
  assertNotContains(opusSection, 'sub-agent calls', 'Opus should not show sub-agent call count');
  assertNotContains(opusSection, 'Sub-agent calls:', 'Opus should not show sub-agent call list');
});

// ==== Test: Single sub-agent call (no per-call display needed) ====

runTest('buildBudgetStatsString with single subAgentCall does not show per-call info', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCalls(1);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertNotContains(result, 'sub-agent calls', 'Should not show call count for single call');
  assertNotContains(result, 'Sub-agent calls:', 'Should not show call list for single call');
});

// ==== Test: Multiple models as sub-agents ====

runTest('buildBudgetStatsString with mixed model sub-agent calls', () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-6': {
        inputTokens: 50000,
        cacheCreationTokens: 0,
        cacheReadTokens: 1000000,
        outputTokens: 10000,
        modelName: 'Claude Opus 4.6',
        modelInfo: { limit: { context: 1000000, output: 128000 } },
        peakContextUsage: 60000,
        costUSD: 1.5,
      },
      'claude-sonnet-4-6': {
        inputTokens: 200000,
        cacheCreationTokens: 0,
        cacheReadTokens: 500000,
        outputTokens: 100000,
        modelName: 'Claude Sonnet 4.6',
        modelInfo: { limit: { context: 1000000, output: 64000 } },
        peakContextUsage: 0,
        costUSD: 3.0,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 50000,
        cacheCreationTokens: 0,
        cacheReadTokens: 200000,
        outputTokens: 30000,
        modelName: 'Claude Haiku 4.5',
        modelInfo: { limit: { context: 200000, output: 32000 } },
        peakContextUsage: 0,
        costUSD: 0.5,
      },
    },
    subSessions: [],
  };
  const subAgentCalls = [
    { id: 'a1', description: 'Task 1', model: 'sonnet' },
    { id: 'a2', description: 'Task 2', model: 'sonnet' },
    { id: 'a3', description: 'Task 3', model: 'sonnet' },
    { id: 'a4', description: 'Task 4', model: 'haiku' },
    { id: 'a5', description: 'Task 5', model: 'haiku' },
  ];
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertContains(result, '3 sub-agent calls', 'Should show 3 sonnet sub-agent calls');
  assertContains(result, '2 sub-agent calls', 'Should show 2 haiku sub-agent calls');
});

// ==== Test: null/empty subAgentCalls handling ====

runTest('buildBudgetStatsString with null subAgentCalls', () => {
  const tokenUsage = makeIssueScenarioData();
  const result = buildBudgetStatsString(tokenUsage, null);
  assertNotContains(result, 'sub-agent calls', 'Should not show sub-agent info for null');
  assertNotContains(result, 'Sub-agent calls:', 'Should not show call list for null');
});

runTest('buildBudgetStatsString with empty subAgentCalls array', () => {
  const tokenUsage = makeIssueScenarioData();
  const result = buildBudgetStatsString(tokenUsage, []);
  assertNotContains(result, 'sub-agent calls', 'Should not show sub-agent info for empty array');
  assertNotContains(result, 'Sub-agent calls:', 'Should not show call list for empty array');
});

// ==== Test: subAgentCalls with default model ====

runTest('buildBudgetStatsString handles sub-agent calls without explicit model', () => {
  const tokenUsage = makeIssueScenarioData();
  // Calls without model specified — these use "default"
  const subAgentCalls = [
    { id: 'a1', description: 'Task 1', model: null },
    { id: 'a2', description: 'Task 2', model: null },
  ];
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  // These calls have model=null which maps to "default", so they shouldn't match any model ID
  assertNotContains(result, 'sub-agent calls', 'Should not match default model to any model ID');
});

// Summary
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);
if (testsFailed > 0) process.exit(1);
