#!/usr/bin/env node

// Test script to verify disk space check with insufficient space
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('🧪 Testing disk space check with insufficient space...\n');

// Test with impossibly high threshold - should fail
console.log('📊 Testing disk space check with 999999MB threshold (should fail)...');

try {
  // Test solve.mjs with high threshold - it should fail quickly
  const result = await $`echo "https://github.com/owner/repo/issues/1" | timeout 15s ./solve.mjs https://github.com/owner/repo/issues/1 --min-disk-space 999999`.catch(e => e);

  if (result.code === 1) {
    console.log('✅ solve.mjs correctly failed with exit code 1 for insufficient disk space');
  } else {
    console.log(`❌ solve.mjs did not fail as expected (exit code: ${result.code})`);
    console.log('Stderr:', result.stderr?.toString());
    console.log('Stdout:', result.stdout?.toString());
  }
} catch (error) {
  console.log(`⚠️  Error during test: ${error.message}`);
}

console.log('\n🎯 Disk space failure test completed');
