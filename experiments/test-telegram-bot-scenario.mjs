#!/usr/bin/env node
// Simulate the scenario from the issue: running telegram-bot with --no-hive
// This test mimics what happens when telegram-bot.mjs imports hive.mjs

console.log('Testing telegram-bot scenario...');
console.log('Simulating process.argv for: hive-telegram-bot --token XXX --allowed-chats "..." --no-hive');

// Set up process.argv to simulate the command from the issue
process.argv = ['/usr/bin/node', '/tmp/test-telegram-bot.mjs', '--token', '849052...aOEM', '--allowed-chats', '(-1002975819706 -1002861722681)', '--no-hive'];

console.log('Current process.argv:', process.argv);

try {
  // Import hive.mjs - this should NOT execute the main logic
  const hiveModule = await import('../src/hive.mjs');
  console.log('✅ Successfully imported hive.mjs with telegram-bot args');
  console.log('✅ createYargsConfig is available:', typeof hiveModule.createYargsConfig === 'function');
  console.log('✅ No argument parsing error occurred');
} catch (error) {
  console.error('❌ Failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}

console.log('✅ Test passed: hive.mjs can be imported by telegram-bot without errors');
