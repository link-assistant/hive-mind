#!/usr/bin/env node

// Test script to verify telegraf loads correctly with use-m

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

console.log('Testing telegraf loading with use-m...');

try {
  const telegrafModule = await use('telegraf');
  const { Telegraf } = telegrafModule;

  console.log('✅ Successfully loaded telegraf');
  console.log('Telegraf constructor:', typeof Telegraf);

  // Test creating a bot instance with a fake token
  const testBot = new Telegraf('test-token');
  console.log('✅ Successfully created Telegraf instance');
  console.log('Test completed successfully!');
} catch (error) {
  console.error('❌ Error loading telegraf:', error);
  process.exit(1);
}
