#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const originalCI = process.env.CI;
delete process.env.CI;

const { $ } = await use('command-stream');
const $silent = $({ mirror: false, capture: true });

try {
  const result = await $silent`uptime 2>/dev/null`;
  console.log('Exit code:', result.code);
  console.log('Stdout:', JSON.stringify(result.stdout));
  console.log('Stdout length:', result.stdout.length);
} catch (error) {
  console.error('Error:', error.message);
}

if (originalCI !== undefined) {
  process.env.CI = originalCI;
}
