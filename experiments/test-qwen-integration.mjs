#!/usr/bin/env node
/**
 * Test script for qwen tool integration
 * Tests basic imports and function exports
 */

console.log('🧪 Testing Qwen integration...\n');

try {
  // Test qwen.lib.mjs imports
  console.log('1. Testing qwen.lib.mjs imports...');
  const qwenLib = await import('../src/qwen.lib.mjs');
  const { mapModelToId, validateQwenConnection, handleQwenRuntimeSwitch, executeQwen, executeQwenCommand, checkForUncommittedChanges } = qwenLib;

  if (!mapModelToId || !validateQwenConnection || !executeQwen || !executeQwenCommand || !checkForUncommittedChanges) {
    throw new Error('Missing required exports from qwen.lib.mjs');
  }
  console.log('   ✅ qwen.lib.mjs exports validated');

  // Test model mapping
  console.log('\n2. Testing model mapping...');
  const testModels = {
    qwen: 'qwen-coder',
    'qwen-coder': 'qwen-coder',
    qwen3: 'qwen3-coder',
    'qwen3-coder': 'qwen3-coder',
    'some-other-model': 'some-other-model',
  };

  for (const [input, expected] of Object.entries(testModels)) {
    const result = mapModelToId(input);
    if (result !== expected) {
      throw new Error(`Model mapping failed: ${input} -> ${result} (expected ${expected})`);
    }
  }
  console.log('   ✅ Model mapping works correctly');

  // Test qwen.prompts.lib.mjs imports
  console.log('\n3. Testing qwen.prompts.lib.mjs imports...');
  const qwenPrompts = await import('../src/qwen.prompts.lib.mjs');
  const { buildUserPrompt, buildSystemPrompt } = qwenPrompts;

  if (!buildUserPrompt || !buildSystemPrompt) {
    throw new Error('Missing required exports from qwen.prompts.lib.mjs');
  }
  console.log('   ✅ qwen.prompts.lib.mjs exports validated');

  // Test prompt building
  console.log('\n4. Testing prompt building...');
  const testParams = {
    issueUrl: 'https://github.com/owner/repo/issues/123',
    issueNumber: '123',
    prNumber: '456',
    prUrl: 'https://github.com/owner/repo/pull/456',
    branchName: 'test-branch',
    tempDir: '/tmp/test',
    isContinueMode: false,
    owner: 'owner',
    repo: 'repo',
    argv: { think: 'medium' },
  };

  const userPrompt = buildUserPrompt(testParams);
  const systemPrompt = buildSystemPrompt(testParams);

  if (!userPrompt || !systemPrompt) {
    throw new Error('Prompt building failed');
  }

  if (!userPrompt.includes('Issue to solve')) {
    throw new Error('User prompt missing expected content');
  }

  if (!systemPrompt.includes('You are AI issue solver using Qwen')) {
    throw new Error('System prompt missing expected content');
  }

  if (!systemPrompt.includes('think hard')) {
    throw new Error('System prompt missing thinking instruction');
  }

  console.log('   ✅ Prompt building works correctly');
  console.log(`   User prompt length: ${userPrompt.length} chars`);
  console.log(`   System prompt length: ${systemPrompt.length} chars`);

  // Test config.lib.mjs timeout
  console.log('\n5. Testing config.lib.mjs qwen timeout...');
  const config = await import('../src/config.lib.mjs');
  const { timeouts } = config;

  if (!timeouts.qwenCli) {
    throw new Error('qwenCli timeout not found in config');
  }

  if (typeof timeouts.qwenCli !== 'number') {
    throw new Error('qwenCli timeout is not a number');
  }

  console.log('   ✅ qwenCli timeout configured correctly');
  console.log(`   Timeout value: ${timeouts.qwenCli}ms`);

  console.log('\n✅ All tests passed!');
  console.log('\n📋 Summary:');
  console.log('   • qwen.lib.mjs - OK');
  console.log('   • qwen.prompts.lib.mjs - OK');
  console.log('   • config.lib.mjs - OK');
  console.log('   • Model mapping - OK');
  console.log('   • Prompt building - OK');
  console.log('\n🎉 Qwen integration is ready to use!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
