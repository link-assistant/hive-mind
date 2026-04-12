#!/usr/bin/env node

/**
 * Regression tests for Issue #1590: Split sub-agent usage stats per call
 *
 * When a working session contains multiple sub-agent calls (Agent tool invocations),
 * the token usage stats should show:
 * 1. The number of sub-agent calls per model
 * 2. A list of each individual sub-agent call with description and actual usage
 * 3. Output percentage should not be misleading (e.g., 530% across 12 calls)
 * 4. When actual per-call usage is available (from parent_tool_use_id tracking),
 *    show real data instead of estimates
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

// Helper: create sub-agent calls array WITHOUT usage data (legacy/fallback mode)
function makeSubAgentCallsNoUsage(count = 12) {
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

// Helper: create sub-agent calls array WITH actual per-call usage data
function makeSubAgentCallsWithUsage(count = 12) {
  const calls = [];
  for (let i = 0; i < count; i++) {
    calls.push({
      id: `toolu_${i}`,
      description: `Sub-agent task ${i + 1}`,
      model: 'sonnet',
      usage: {
        inputTokens: 5000 + i * 100,
        cacheCreationTokens: 1000 + i * 50,
        cacheReadTokens: 300000 + i * 5000,
        outputTokens: 25000 + i * 500,
        totalTokens: 79000 + i * 1000,
      },
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

// ==== Test: With sub-agent calls (no usage data - fallback estimates) ====

runTest('buildBudgetStatsString with subAgentCalls (no usage) shows call count', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsNoUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertContains(result, '12 sub-agent calls', 'Should show sub-agent call count');
});

runTest('buildBudgetStatsString with subAgentCalls (no usage) shows estimate note', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsNoUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertContains(result, 'Per-call values are estimates', 'Should show estimate disclaimer');
  assertContains(result, 'upstream support', 'Should link to upstream issue');
  // Estimates use ~ prefix
  assertContains(result, '~', 'Should use ~ prefix for estimates');
});

runTest('buildBudgetStatsString with subAgentCalls (no usage) shows limits and percentages per call', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsNoUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  // Each estimated call should show limits and percentages: ~381.8K / 1M (38%) input tokens, ~28.2K / 64K (44%) output tokens
  assertContains(result, '/ 1M', 'Should show context limit for estimated calls');
  assertContains(result, '/ 64K', 'Should show output limit for estimated calls');
  assertContains(result, '%) input tokens', 'Should show input percentage');
  assertContains(result, '%) output tokens', 'Should show output percentage');
});

// ==== Test: With sub-agent calls WITH actual usage data ====

runTest('buildBudgetStatsString with actual per-call usage shows limits and percentages', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsWithUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertContains(result, '12 sub-agent calls', 'Should show sub-agent call count');
  assertContains(result, 'Sub-agent calls:', 'Should show sub-agent calls section header');
  // Each call should show limits and percentages (e.g., "306K / 1M (31%) input tokens, 25K / 64K (39%) output tokens")
  assertContains(result, '/ 1M', 'Should show context limit for actual calls');
  assertContains(result, '/ 64K', 'Should show output limit for actual calls');
  assertContains(result, '%) input tokens', 'Should show input percentage');
  assertContains(result, '%) output tokens', 'Should show output percentage');
  // Each call should be numbered
  for (let i = 1; i <= 12; i++) {
    assertContains(result, `${i}. `, `Should list sub-agent call ${i} numbered`);
  }
});

runTest('buildBudgetStatsString with actual usage does NOT show estimate disclaimer', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsWithUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertNotContains(result, 'Per-call values are estimates', 'Should NOT show estimate disclaimer when actual data available');
  assertNotContains(result, 'upstream support', 'Should NOT show upstream link when actual data available');
});

runTest('buildBudgetStatsString with actual usage shows real token counts without ~ prefix', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsWithUsage(3);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  // With actual usage, values should NOT have ~ prefix (they are real, not estimates)
  const subAgentSection = result.split('Sub-agent calls:')[1] || '';
  assertNotContains(subAgentSection, '~', 'Should NOT use ~ prefix when showing actual usage');
});

runTest('buildBudgetStatsString with subAgentCalls hides misleading output percentage on Total line', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsWithUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  // The Total line for Sonnet should NOT show 530% anymore
  const sonnetSection = result.split('Claude Sonnet')[1] || '';
  assertNotContains(sonnetSection.split('\n\n')[0], '530%', 'Sonnet Total line should not show misleading 530% percentage');
});

runTest('buildBudgetStatsString main model (Opus) not affected by sub-agent calls', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsWithUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  // Opus section should not mention sub-agent calls
  const opusSection = result.split('Claude Sonnet')[0];
  assertNotContains(opusSection, 'sub-agent calls', 'Opus should not show sub-agent call count');
  assertNotContains(opusSection, 'Sub-agent calls:', 'Opus should not show sub-agent call list');
});

// ==== Test: Single sub-agent call (no per-call display needed) ====

runTest('buildBudgetStatsString with single subAgentCall does not show per-call info', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsWithUsage(1);
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
    { id: 'a1', description: 'Task 1', model: 'sonnet', usage: { inputTokens: 1000, cacheCreationTokens: 0, cacheReadTokens: 150000, outputTokens: 30000 } },
    { id: 'a2', description: 'Task 2', model: 'sonnet', usage: { inputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 160000, outputTokens: 35000 } },
    { id: 'a3', description: 'Task 3', model: 'sonnet', usage: { inputTokens: 3000, cacheCreationTokens: 0, cacheReadTokens: 170000, outputTokens: 40000 } },
    { id: 'a4', description: 'Task 4', model: 'haiku', usage: { inputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 90000, outputTokens: 12000 } },
    { id: 'a5', description: 'Task 5', model: 'haiku', usage: { inputTokens: 600, cacheCreationTokens: 0, cacheReadTokens: 100000, outputTokens: 15000 } },
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

// ==== Test: Individual call list with no usage data (backward compat for subAgentCalls format) ====

runTest('buildBudgetStatsString lists each sub-agent call numbered (no usage)', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsNoUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  assertContains(result, 'Sub-agent calls:', 'Should show sub-agent calls section header');
  // Each call should be numbered with limits and percentages
  for (let i = 1; i <= 12; i++) {
    assertContains(result, `${i}. `, `Should list sub-agent call ${i} numbered`);
  }
  assertContains(result, '/ 1M', 'Should show context limit');
  assertContains(result, '/ 64K', 'Should show output limit');
});

// ==== Test: Total line appears AFTER sub-agent calls, not before ====

runTest('buildBudgetStatsString Total line appears after Sub-agent calls section (actual usage)', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsWithUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  const subAgentCallsPos = result.indexOf('Sub-agent calls:');
  const totalPos = result.lastIndexOf('Total:');
  if (subAgentCallsPos === -1) throw new Error('Sub-agent calls: section not found');
  if (totalPos === -1) throw new Error('Total: line not found');
  if (totalPos <= subAgentCallsPos) {
    throw new Error(`Total: (pos ${totalPos}) should appear AFTER Sub-agent calls: (pos ${subAgentCallsPos}), but it appears before`);
  }
});

runTest('buildBudgetStatsString Total line appears after Sub-agent calls section (estimated usage)', () => {
  const tokenUsage = makeIssueScenarioData();
  const subAgentCalls = makeSubAgentCallsNoUsage(12);
  const result = buildBudgetStatsString(tokenUsage, subAgentCalls);
  const subAgentCallsPos = result.indexOf('Sub-agent calls:');
  const totalPos = result.lastIndexOf('Total:');
  if (subAgentCallsPos === -1) throw new Error('Sub-agent calls: section not found');
  if (totalPos === -1) throw new Error('Total: line not found');
  if (totalPos <= subAgentCallsPos) {
    throw new Error(`Total: (pos ${totalPos}) should appear AFTER Sub-agent calls: (pos ${subAgentCallsPos}), but it appears before`);
  }
});

// Summary
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);
if (testsFailed > 0) process.exit(1);
