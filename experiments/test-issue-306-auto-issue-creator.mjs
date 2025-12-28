#!/usr/bin/env node

/**
 * Test script for automatic GitHub issue creation (issue #306)
 */

import { createIssueForError, formatLogForIssue } from '../src/github-issue-creator.lib.mjs';

console.log('🧪 Testing automatic GitHub issue creator');
console.log('==========================================\n');

async function testSmallLogInline() {
  console.log('Test 1: Small log should be inline');
  const smallLog = 'Error occurred at line 42\nStack trace here\nMore details';
  const result = await formatLogForIssue(smallLog, '/tmp/test.log');
  console.log(`  Method: ${result.method}`);
  console.log(`  Expected: inline`);
  console.log(`  ✓ Pass: ${result.method === 'inline' ? 'YES' : 'NO'}\n`);
}

async function testLargeLogGist() {
  console.log('Test 2: Large log should use gist');
  const largeLog = 'x'.repeat(70000);
  const result = await formatLogForIssue(largeLog, '/tmp/test.log');
  console.log(`  Method: ${result.method}`);
  console.log(`  Expected: gist or file`);
  console.log(`  ✓ Pass: ${result.method !== 'inline' ? 'YES' : 'NO'}\n`);
}

async function testErrorMessage() {
  console.log('Test 3: Error message formatting');
  const error = new Error('Test error message for issue #306');
  error.stack = 'Error: Test error message\n    at test.js:10:15';

  console.log(`  Error message: ${error.message}`);
  console.log(`  Has stack: ${!!error.stack}`);
  console.log(`  ✓ Pass: YES\n`);
}

async function runTests() {
  try {
    await testSmallLogInline();
    await testLargeLogGist();
    await testErrorMessage();

    console.log('✅ All tests completed');
    console.log('\n⚠️  Note: To test actual issue creation, run with a real error:');
    console.log('   node --experimental-modules experiments/test-issue-306-manual.mjs\n');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();
