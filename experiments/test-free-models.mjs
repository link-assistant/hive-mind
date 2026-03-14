#!/usr/bin/env node

/**
 * Test script for free model support
 * Tests all 5 mentioned free models to ensure they work and are not blocked
 */

import { execSync } from 'child_process';
import { validateModelName } from '../src/model-validation.lib.mjs';

const FREE_MODELS = ['opencode/big-pickle', 'opencode/gpt-5-nano', 'opencode/kimi-k2.5-free', 'opencode/glm-4.7-free', 'opencode/minimax-m2.1-free'];

console.log('🧪 Testing free model support in hive-mind\n');

// Test 1: Model validation
console.log('1️⃣ Testing model validation...');
for (const model of FREE_MODELS) {
  try {
    const result = validateModelName(model, 'agent');
    if (result.valid) {
      console.log(`✅ ${model}: Valid (${result.mappedModel})`);
    } else {
      console.log(`❌ ${model}: Invalid - ${result.message}`);
    }
  } catch (error) {
    console.log(`❌ ${model}: Error - ${error.message}`);
  }
}

console.log('\n2️⃣ Testing agent CLI model validation...');
// Test 2: Check if agent CLI recognizes these models
for (const model of FREE_MODELS) {
  try {
    // Just validate the argument parsing, don't actually run the full solve
    const output = execSync(`node src/solve.mjs --tool agent --model ${model} --dry-run --skip-tool-connection-check https://github.com/test/test/issues/1 2>&1`, {
      timeout: 30000,
      stdio: 'pipe',
    }).toString();

    if (output.includes('Unrecognized model') || output.includes('is not compatible')) {
      console.log(`❌ ${model}: Rejected by agent CLI`);
    } else {
      console.log(`✅ ${model}: Accepted by agent CLI`);
    }
  } catch (error) {
    const errorOutput = error.stdout?.toString() || error.stderr?.toString() || error.message;
    if (errorOutput.includes('Unrecognized model') || errorOutput.includes('is not compatible')) {
      console.log(`❌ ${model}: Rejected by agent CLI - ${errorOutput.trim()}`);
    } else {
      console.log(`⚠️  ${model}: Error during test - ${error.message.slice(0, 100)}`);
    }
  }
}

console.log('\n🎯 Free model support test completed!');
