#!/usr/bin/env node
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');

// Test 1: Array interpolation with values
const args = ['--version'];
const result1 = await $`echo ${args} hello`;
console.log('Test 1 (array with values):', result1.stdout?.toString().trim());

// Test 2: Empty array interpolation
const emptyArgs = [];
const result2 = await $`echo ${emptyArgs} hello`;
console.log('Test 2 (empty array):', result2.stdout?.toString().trim());

// Test 3: Array with multiple values
const multiArgs = ['--strict-mcp-config', '--mcp-config', '/tmp/test.json'];
const result3 = await $`echo ${multiArgs} hello`;
console.log('Test 3 (multi-value array):', result3.stdout?.toString().trim());
