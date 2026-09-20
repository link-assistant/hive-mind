#!/usr/bin/env node

// Test simpler commands to isolate the issue

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const originalCI = process.env.CI;
delete process.env.CI;

const { $ } = await use('command-stream');
const $silent = $({ mirror: false, capture: true });

console.log('Testing simple commands...');

try {
  console.log('\n1. Testing cat /proc/meminfo:');
  const result1 = await $silent`cat /proc/meminfo`;
  console.log('Exit code:', result1.code);
  console.log('Stdout length:', result1.stdout.length);

  console.log('\n2. Testing with grep:');
  const result2 = await $silent`grep -E "MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree" /proc/meminfo`;
  console.log('Exit code:', result2.code);
  console.log('Stdout:', result2.stdout);
} catch (error) {
  console.error('Error:', error.message);
}

// Restore CI environment
if (originalCI !== undefined) {
  process.env.CI = originalCI;
}
