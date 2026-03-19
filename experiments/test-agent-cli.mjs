#!/usr/bin/env node

/**
 * Test agent CLI support for free models
 */

import { execSync } from 'child_process';

const FREE_MODELS = ['opencode/big-pickle', 'opencode/gpt-5-nano', 'opencode/kimi-k2.5-free', 'opencode/glm-4.7-free', 'opencode/minimax-m2.1-free'];

console.log('🔧 Testing agent CLI support for free models\n');

for (const model of FREE_MODELS) {
  try {
    // Test if agent CLI accepts the model (just echo "hello" to stdin)
    const output = execSync(`echo "hello" | timeout 5s agent --model ${model} --json-standard opencode`, {
      timeout: 10000,
      stdio: 'pipe',
      shell: true,
    }).toString();

    console.log(`✅ ${model}: Accepted by agent CLI`);
  } catch (error) {
    const errorOutput = error.stderr?.toString() || error.stdout?.toString() || error.message;
    if (errorOutput.includes('Unknown model') || errorOutput.includes('not found') || errorOutput.includes('unsupported')) {
      console.log(`❌ ${model}: Rejected by agent CLI - ${errorOutput.trim()}`);
    } else {
      console.log(`⚠️  ${model}: Error during test - ${error.message.slice(0, 100)}`);
    }
  }
}

console.log('\n🎯 Agent CLI support test completed!');
