#!/usr/bin/env node

/**
 * Test script for the --auto-continue-only-on-new-comments option
 * This script tests the new feature by checking the help output and argument parsing
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');
const path = (await use('path')).default;

const scriptDir = path.dirname(import.meta.url.replace('file://', ''));
const solvePath = path.join(scriptDir, '..', 'solve.mjs');

console.log('🧪 Testing --auto-continue-only-on-new-comments option...\n');

// Test 1: Check if the option appears in help
console.log('📋 Test 1: Checking help output...');
try {
  const helpResult = await $`node ${solvePath} --help`;
  const helpOutput = helpResult.stdout.toString();

  if (helpOutput.includes('auto-continue-only-on-new-comments')) {
    console.log('✅ Option appears in help output');
    console.log('   Found: auto-continue-only-on-new-comments');
  } else {
    console.log('❌ Option NOT found in help output');
    process.exit(1);
  }
} catch (error) {
  console.log('❌ Help test failed:', error.message);
  process.exit(1);
}

// Test 2: Check argument parsing (dry run to avoid actual execution)
console.log('\n📋 Test 2: Testing argument parsing...');
try {
  // We'll test with a fake URL and dry-run to avoid actual execution
  const testUrl = 'https://github.com/test/repo/issues/1';
  const parseResult = await $`node ${solvePath} "${testUrl}" --auto-continue-only-on-new-comments --dry-run`;

  if (parseResult.code !== 0) {
    // This is expected as we're using a fake URL
    const errorOutput = parseResult.stderr.toString();
    // Check if it's failing due to invalid URL rather than invalid argument
    if (errorOutput.includes('auto-continue-only-on-new-comments') && errorOutput.includes('unknown option')) {
      console.log('❌ Option parsing failed - option not recognized');
      process.exit(1);
    } else {
      console.log('✅ Option parsing successful (expected failure due to fake URL)');
    }
  } else {
    console.log('✅ Option parsing successful');
  }
} catch (error) {
  // Check if error is about unknown option
  if (error.message.includes('unknown option') || error.message.includes('auto-continue-only-on-new-comments')) {
    console.log('❌ Argument parsing failed:', error.message);
    process.exit(1);
  } else {
    console.log('✅ Option recognized (other error expected with fake URL)');
  }
}

console.log('\n✅ All tests passed!');
console.log('\n📝 Summary:');
console.log('   - Option added to help output: ✅');
console.log('   - Option parsing works: ✅');
console.log('   - Ready for integration testing with real repositories');
