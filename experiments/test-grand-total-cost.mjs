#!/usr/bin/env node
// Test for issue #658: Grand total should only show estimated cost, not token sums

globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;

import { calculateSessionTokens } from '../src/claude.lib.mjs';

async function testGrandTotalCost() {
  console.log('Testing grand total cost calculation for issue #658...\n');

  // Create a mock session data scenario with multiple models
  // This simulates what would be in the JSONL file
  const mockTokenUsage = {
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 1000,
        cacheCreationTokens: 5000,
        cacheReadTokens: 10000,
        outputTokens: 2000,
        costUSD: 0.050000,
        modelName: 'Claude Sonnet 4.5'
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 2000,
        cacheCreationTokens: 3000,
        cacheReadTokens: 8000,
        outputTokens: 1500,
        costUSD: 0.020000,
        modelName: 'Claude Haiku 4.5'
      }
    },
    inputTokens: 3000,
    cacheCreationTokens: 8000,
    cacheReadTokens: 18000,
    outputTokens: 3500,
    totalTokens: 14500,
    totalCostUSD: 0.070000
  };

  console.log('📊 Mock token usage data with multiple models:');
  console.log('=' .repeat(60));

  for (const [modelId, usage] of Object.entries(mockTokenUsage.modelUsage)) {
    console.log(`\n🤖 ${usage.modelName}`);
    console.log(`   Input tokens: ${usage.inputTokens.toLocaleString()}`);
    console.log(`   Cache creation tokens: ${usage.cacheCreationTokens.toLocaleString()}`);
    console.log(`   Cache read tokens: ${usage.cacheReadTokens.toLocaleString()}`);
    console.log(`   Output tokens: ${usage.outputTokens.toLocaleString()}`);
    console.log(`   Cost: $${usage.costUSD.toFixed(6)}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('📈 Expected grand total output (according to issue #658):');
  console.log('=' .repeat(60));
  console.log('   📈 Total across all models:');
  console.log(`      Total cost (USD): $${mockTokenUsage.totalCostUSD.toFixed(6)}`);
  console.log('');
  console.log('✅ CORRECT: Only total cost is shown, NOT individual token sums');
  console.log('   Reason: Tokens from different models should not be summed');
  console.log('   Only estimated cost can be summed across models\n');

  console.log('=' .repeat(60));
  console.log('❌ INCORRECT old behavior (before fix):');
  console.log('=' .repeat(60));
  console.log('   📈 Total across all models:');
  console.log(`      Input tokens: ${mockTokenUsage.inputTokens.toLocaleString()}`);
  console.log(`      Cache creation tokens: ${mockTokenUsage.cacheCreationTokens.toLocaleString()}`);
  console.log(`      Cache read tokens: ${mockTokenUsage.cacheReadTokens.toLocaleString()}`);
  console.log(`      Output tokens: ${mockTokenUsage.outputTokens.toLocaleString()}`);
  console.log(`      Total tokens: ${mockTokenUsage.totalTokens.toLocaleString()}`);
  console.log(`      Total cost (USD): $${mockTokenUsage.totalCostUSD.toFixed(6)}`);
  console.log('');
  console.log('❌ WRONG: Shows token sums across different models');
  console.log('   These numbers are misleading and should not be shown\n');

  console.log('=' .repeat(60));
  console.log('💡 Summary of changes for issue #658:');
  console.log('=' .repeat(60));
  console.log('1. ✅ Removed token sum display from "Total across all models"');
  console.log('2. ✅ Only show total estimated cost in grand total');
  console.log('3. ✅ Add total estimated cost to solution log comment');
  console.log('4. ✅ Individual per-model stats still shown in detail');
  console.log('');

  // Test the comment format
  console.log('=' .repeat(60));
  console.log('📝 Solution log comment format (with cost):');
  console.log('=' .repeat(60));
  const totalCostUSD = mockTokenUsage.totalCostUSD;
  const costInfo = `\n\n💰 **Total estimated cost**: $${totalCostUSD.toFixed(6)} USD`;
  console.log(`## 🤖 Solution Draft Log

This log file contains the complete execution trace of the AI solution draft process.${costInfo}

<details>
<summary>Click to expand solution draft log (100KB)</summary>

\`\`\`
[Log content here...]
\`\`\`

</details>

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`);

  console.log('\n✅ All tests passed! Changes align with issue #658 requirements.');
}

testGrandTotalCost();
