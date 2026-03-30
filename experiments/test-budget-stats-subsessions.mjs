#!/usr/bin/env node

/**
 * Experiment script demonstrating sub-session tracking with compactification
 *
 * This script simulates how token budget statistics look when compactification
 * events occur during a Claude Code session, including:
 * - Sub-session breakdown with peak context per sub-session
 * - Cumulative totals with cached tokens shown separately
 * - Single vs multiple sub-session display formats
 *
 * Usage:
 *   node experiments/test-budget-stats-subsessions.mjs
 */

import { buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';

console.log('🧪 Token Budget Statistics - Sub-Session Tracking Demo\n');
console.log('This experiment demonstrates how budget stats display when');
console.log('compactification events occur during a Claude Code session.\n');

// Scenario 1: No compactification (normal session) — simplified format
console.log('━'.repeat(70));
console.log('\n📋 Scenario 1: Normal session (no compactification) — simplified format\n');

const normalSession = {
  inputTokens: 45000,
  cacheCreationTokens: 8000,
  cacheReadTokens: 3000,
  outputTokens: 12000,
  totalTokens: 65000,
  subSessions: [{ inputTokens: 45000, cacheCreationTokens: 8000, cacheReadTokens: 3000, outputTokens: 12000, messageCount: 28, peakContextUsage: 52000, peakOutputUsage: 12000 }],
  compactifications: null,
  modelUsage: {
    'claude-sonnet-4-5-20250929': {
      inputTokens: 45000,
      cacheCreationTokens: 8000,
      cacheReadTokens: 3000,
      outputTokens: 12000,
      modelName: 'Claude Sonnet 4.5',
      modelInfo: { limit: { context: 200000, output: 64000 } },
      peakContextUsage: 52000,
    },
  },
};

console.log(buildBudgetStatsString(normalSession));

// Scenario 2: One compactification — numbered sub-session list
console.log('\n\n' + '━'.repeat(70));
console.log('\n📋 Scenario 2: Session with 1 compactification — numbered list\n');

const oneCompact = {
  inputTokens: 185000,
  cacheCreationTokens: 25000,
  cacheReadTokens: 12000,
  outputTokens: 45000,
  totalTokens: 255000,
  subSessions: [
    { inputTokens: 120000, cacheCreationTokens: 18000, cacheReadTokens: 9000, outputTokens: 28000, messageCount: 35, peakContextUsage: 145000, peakOutputUsage: 28000 },
    { inputTokens: 65000, cacheCreationTokens: 7000, cacheReadTokens: 3000, outputTokens: 17000, messageCount: 22, peakContextUsage: 72000, peakOutputUsage: 17000 },
  ],
  compactifications: [{ timestamp: '2026-03-29T14:23:00Z', preTokens: 167219, trigger: 'auto' }],
  modelUsage: {
    'claude-opus-4-6-20260529': {
      inputTokens: 185000,
      cacheCreationTokens: 25000,
      cacheReadTokens: 12000,
      outputTokens: 45000,
      modelName: 'Claude Opus 4.6',
      modelInfo: { limit: { context: 200000, output: 32000 } },
      peakContextUsage: 145000,
    },
  },
};

console.log(buildBudgetStatsString(oneCompact));

// Scenario 3: Multiple compactifications
console.log('\n\n' + '━'.repeat(70));
console.log('\n📋 Scenario 3: Long session with 3 compactifications\n');

const multiCompact = {
  inputTokens: 520000,
  cacheCreationTokens: 60000,
  cacheReadTokens: 35000,
  outputTokens: 120000,
  totalTokens: 700000,
  subSessions: [
    { inputTokens: 160000, cacheCreationTokens: 20000, cacheReadTokens: 10000, outputTokens: 35000, messageCount: 42, peakContextUsage: 185000, peakOutputUsage: 35000 },
    { inputTokens: 140000, cacheCreationTokens: 15000, cacheReadTokens: 9000, outputTokens: 30000, messageCount: 38, peakContextUsage: 160000, peakOutputUsage: 30000 },
    { inputTokens: 130000, cacheCreationTokens: 14000, cacheReadTokens: 8000, outputTokens: 28000, messageCount: 35, peakContextUsage: 148000, peakOutputUsage: 28000 },
    { inputTokens: 90000, cacheCreationTokens: 11000, cacheReadTokens: 8000, outputTokens: 27000, messageCount: 25, peakContextUsage: 105000, peakOutputUsage: 27000 },
  ],
  compactifications: [
    { timestamp: '2026-03-29T10:15:00Z', preTokens: 190000, trigger: 'auto' },
    { timestamp: '2026-03-29T12:45:00Z', preTokens: 185000, trigger: 'auto' },
    { timestamp: '2026-03-29T15:30:00Z', preTokens: 178000, trigger: 'auto' },
  ],
  modelUsage: {
    'claude-sonnet-4-6-20260529': {
      inputTokens: 520000,
      cacheCreationTokens: 60000,
      cacheReadTokens: 35000,
      outputTokens: 120000,
      modelName: 'Claude Sonnet 4.6',
      modelInfo: { limit: { context: 200000, output: 64000 } },
      peakContextUsage: 185000,
    },
  },
};

console.log(buildBudgetStatsString(multiCompact));

// Scenario 4: Multi-model session
console.log('\n\n' + '━'.repeat(70));
console.log('\n📋 Scenario 4: Multi-model session (main + subagent)\n');

const multiModel = {
  inputTokens: 95000,
  cacheCreationTokens: 12000,
  cacheReadTokens: 7000,
  outputTokens: 28000,
  totalTokens: 135000,
  subSessions: [{ inputTokens: 95000, cacheCreationTokens: 12000, cacheReadTokens: 7000, outputTokens: 28000, messageCount: 40, peakContextUsage: 80000, peakOutputUsage: 20000 }],
  compactifications: null,
  modelUsage: {
    'claude-opus-4-6-20260529': {
      inputTokens: 70000,
      cacheCreationTokens: 10000,
      cacheReadTokens: 5000,
      outputTokens: 20000,
      modelName: 'Claude Opus 4.6',
      modelInfo: { limit: { context: 200000, output: 32000 } },
      peakContextUsage: 80000,
    },
    'claude-haiku-4-5-20251001': {
      inputTokens: 25000,
      cacheCreationTokens: 2000,
      cacheReadTokens: 2000,
      outputTokens: 8000,
      modelName: 'Claude Haiku 4.5',
      modelInfo: { limit: { context: 200000, output: 64000 } },
      peakContextUsage: 28000,
    },
  },
};

console.log(buildBudgetStatsString(multiModel));

console.log('\n\n' + '━'.repeat(70));
console.log('\n✅ Experiment completed!\n');
console.log('📝 Key Observations:');
console.log('   - Single sub-session uses simplified format (Max context / Max output)');
console.log('   - Multiple sub-sessions show numbered list with per-session peak context');
console.log('   - Totals show input + cached tokens separately');
console.log('   - Multi-model sessions show per-model context/output usage with bold labels');
console.log('   - No JSONL deduplication or stream comparison noise in output\n');
