#!/usr/bin/env node

// Test the $silent command to see what's wrong

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const originalCI = process.env.CI;
delete process.env.CI;

const { $ } = await use('command-stream');
const $silent = $({ mirror: false, capture: true });

console.log('Testing $silent command...');

try {
  const result = await $silent`cat /proc/meminfo 2>/dev/null | grep -E "MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree"`;
  console.log('Result:', result);
  console.log('Stdout:', result.stdout);
  console.log('Stderr:', result.stderr);
  console.log('Exit code:', result.exitCode);
} catch (error) {
  console.error('Error:', error.message);
}

// Restore CI environment
if (originalCI !== undefined) {
  process.env.CI = originalCI;
}
