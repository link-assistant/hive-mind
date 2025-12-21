#!/usr/bin/env node

/**
 * Experiment script to demonstrate --tokens-budget-stats feature
 *
 * This script tests the new token budget statistics feature by creating
 * a mock scenario that simulates token usage data.
 *
 * Usage:
 *   node experiments/test-tokens-budget-stats.mjs
 *
 * To test the actual feature with a real Claude session:
 *   solve <issue-url> --tool claude --tokens-budget-stats
 */

import { formatNumber } from '../src/claude.lib.mjs';

console.log('🧪 Testing Token Budget Statistics Feature\n');
console.log('This experiment demonstrates the --tokens-budget-stats output format.\n');

// Mock usage data similar to what would come from a real Claude session
const mockUsageScenarios = [
  {
    name: 'Small Task (Low Usage)',
    modelInfo: {
      id: 'claude-sonnet-4-5-20250929',
      name: 'Claude Sonnet 4.5',
      provider: 'Anthropic',
      limit: {
        context: 200000,
        output: 64000
      }
    },
    usage: {
      inputTokens: 15000,
      cacheCreationTokens: 2000,
      cacheReadTokens: 500,
      outputTokens: 3000
    }
  },
  {
    name: 'Medium Task (Moderate Usage)',
    modelInfo: {
      id: 'claude-sonnet-4-5-20250929',
      name: 'Claude Sonnet 4.5',
      provider: 'Anthropic',
      limit: {
        context: 200000,
        output: 64000
      }
    },
    usage: {
      inputTokens: 85000,
      cacheCreationTokens: 12000,
      cacheReadTokens: 8000,
      outputTokens: 18000
    }
  },
  {
    name: 'Large Task (High Usage)',
    modelInfo: {
      id: 'claude-sonnet-4-5-20250929',
      name: 'Claude Sonnet 4.5',
      provider: 'Anthropic',
      limit: {
        context: 200000,
        output: 64000
      }
    },
    usage: {
      inputTokens: 150000,
      cacheCreationTokens: 25000,
      cacheReadTokens: 15000,
      outputTokens: 45000
    }
  },
  {
    name: 'Extended Context (1M Window)',
    modelInfo: {
      id: 'claude-sonnet-4-5-20250929',
      name: 'Claude Sonnet 4.5 (Extended)',
      provider: 'Anthropic',
      limit: {
        context: 1000000,
        output: 64000
      }
    },
    usage: {
      inputTokens: 450000,
      cacheCreationTokens: 100000,
      cacheReadTokens: 50000,
      outputTokens: 32000
    }
  }
];

// Function to display budget stats (matching the actual implementation)
const displayBudgetStats = scenario => {
  const { modelInfo, usage } = scenario;

  console.log('\n      📊 Token Budget Statistics:');

  // Context window usage
  if (modelInfo.limit.context) {
    const contextLimit = modelInfo.limit.context;
    const totalInputUsed = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
    const contextUsageRatio = totalInputUsed / contextLimit;
    const contextUsagePercent = (contextUsageRatio * 100).toFixed(2);

    console.log(`        Context window:`);
    console.log(`          Used: ${formatNumber(totalInputUsed)} tokens`);
    console.log(`          Limit: ${formatNumber(contextLimit)} tokens`);
    console.log(`          Ratio: ${contextUsageRatio.toFixed(4)} (${contextUsagePercent}%)`);
  }

  // Output tokens usage
  if (modelInfo.limit.output) {
    const outputLimit = modelInfo.limit.output;
    const outputUsageRatio = usage.outputTokens / outputLimit;
    const outputUsagePercent = (outputUsageRatio * 100).toFixed(2);

    console.log(`        Output tokens:`);
    console.log(`          Used: ${formatNumber(usage.outputTokens)} tokens`);
    console.log(`          Limit: ${formatNumber(outputLimit)} tokens`);
    console.log(`          Ratio: ${outputUsageRatio.toFixed(4)} (${outputUsagePercent}%)`);
  }

  // Total session tokens
  const totalSessionTokens = usage.inputTokens + usage.cacheCreationTokens + usage.outputTokens;
  console.log(`        Total session tokens: ${formatNumber(totalSessionTokens)}`);
};

// Run through all scenarios
for (const scenario of mockUsageScenarios) {
  console.log('━'.repeat(70));
  console.log(`\n📋 Scenario: ${scenario.name}`);
  console.log(`   Model: ${scenario.modelInfo.name}`);
  console.log(`   Context Limit: ${formatNumber(scenario.modelInfo.limit.context)} tokens`);
  console.log(`   Output Limit: ${formatNumber(scenario.modelInfo.limit.output)} tokens`);

  displayBudgetStats(scenario);
  console.log('');
}

console.log('━'.repeat(70));
console.log('\n✅ Experiment completed!\n');
console.log('📝 Key Observations:');
console.log('   • Budget stats show absolute token counts and usage ratios');
console.log('   • Context window includes input + cache creation + cache read tokens');
console.log('   • Percentages help quickly identify if approaching limits');
console.log('   • Different model configurations (200K vs 1M) are handled correctly');
console.log('\n💡 To test with a real Claude session:');
console.log('   solve <issue-url> --tool claude --tokens-budget-stats\n');
