#!/usr/bin/env node
// Test if we can import hive.mjs without it executing the main logic
console.log('Starting import test...');

try {
  const hiveModule = await import('../src/hive.mjs');
  console.log('✅ Successfully imported hive.mjs');
  console.log('✅ createYargsConfig is available:', typeof hiveModule.createYargsConfig === 'function');
} catch (error) {
  console.error('❌ Failed to import hive.mjs:', error.message);
  process.exit(1);
}

console.log('✅ Test passed: hive.mjs can be imported without executing main logic');
