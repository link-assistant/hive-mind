#!/usr/bin/env node
/**
 * Experiment: Test command-stream result types
 *
 * This script tests how command-stream returns results and
 * what type stdout is.
 */

// Use dynamic import like the main code does
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');

async function testCommandStreamTypes() {
  console.log('Testing command-stream result types...\n');

  try {
    // Test a simple echo command to understand the result structure
    console.log('Test 1: Simple echo command');
    const result1 = await $`echo "Hello World"`;
    console.log('result1 type:', typeof result1);
    console.log('result1 keys:', Object.keys(result1));
    console.log('result1.stdout type:', typeof result1.stdout);
    console.log('result1.stdout is Buffer:', Buffer.isBuffer(result1.stdout));
    console.log('result1.stdout value:', result1.stdout);
    console.log('result1.stdout?.toString():', result1.stdout?.toString());
    console.log('result1.toString():', result1.toString());
    console.log();

    // Test gh pr comment (this will fail but shows the structure)
    console.log('Test 2: gh pr comment (to test repo)');
    const testBody = `🧪 Type test - ${Date.now()}`;
    const result2 = await $`gh pr comment 846 --repo link-assistant/hive-mind --body ${testBody}`;

    console.log('result2 type:', typeof result2);
    console.log('result2 keys:', Object.keys(result2));
    console.log('result2.stdout type:', typeof result2.stdout);
    console.log('result2.stdout is Buffer:', Buffer.isBuffer(result2.stdout));
    console.log('result2.stdout raw:', result2.stdout);
    console.log('result2.stdout?.toString():', result2.stdout?.toString());
    console.log('result2.toString():', result2.toString());

    // Try to extract comment ID
    const output = result2.stdout?.toString() || result2.toString() || '';
    console.log('\nExtracted output:', output);
    const match = output.match(/issuecomment-(\d+)/);
    console.log('Regex match:', match);
    console.log('Extracted ID:', match ? match[1] : 'NOT FOUND');

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Error type:', error.constructor.name);
  }
}

testCommandStreamTypes();
