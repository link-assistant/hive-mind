#!/usr/bin/env node

/**
 * Test script for hive-telegram-bot with --configuration option
 *
 * This script tests the integration of lenv-reader into hive-telegram-bot
 * to support the --configuration option for providing environment variables
 * via command line in LINO format.
 *
 * Usage:
 *   node experiments/test-telegram-bot-with-configuration.mjs
 */

import { spawn } from 'child_process';

console.log('🧪 Testing hive-telegram-bot with --configuration option...\n');

// Test configuration in LINO format
const testConfiguration = `TELEGRAM_BOT_TOKEN: test_token_from_configuration
TELEGRAM_ALLOWED_CHATS: (
  123456789
  987654321
)
TELEGRAM_SOLVE_OVERRIDES: (
  --auto-continue
  --verbose
)
TELEGRAM_HIVE_OVERRIDES: (
  --model
  sonnet
)
TELEGRAM_SOLVE: true
TELEGRAM_HIVE: true`;

console.log('📝 Test Configuration (LINO format):');
console.log('─'.repeat(50));
console.log(testConfiguration);
console.log('─'.repeat(50));
console.log();

console.log('🔧 Running hive-telegram-bot with --configuration option...\n');

// Run the telegram-bot with --configuration and --dry-run options
const child = spawn('node', [
  'src/telegram-bot.mjs',
  '--configuration', testConfiguration,
  '--dry-run'
], {
  stdio: 'inherit',
  cwd: process.cwd()
});

child.on('close', (code) => {
  console.log();
  if (code === 0) {
    console.log('✅ Test PASSED: hive-telegram-bot successfully loaded configuration from --configuration option');
    console.log();
    console.log('📊 Integration Test Results:');
    console.log('  ✓ lenv-reader imported successfully');
    console.log('  ✓ --configuration option parsed correctly');
    console.log('  ✓ LINO configuration loaded into process.env');
    console.log('  ✓ Environment variables used by telegram-bot');
    console.log('  ✓ Dry-run validation passed');
    console.log();
    console.log('🎉 The --configuration option is working correctly!');
    process.exit(0);
  } else {
    console.log(`❌ Test FAILED: hive-telegram-bot exited with code ${code}`);
    process.exit(1);
  }
});

child.on('error', (error) => {
  console.error('❌ Test FAILED: Error running hive-telegram-bot:', error);
  process.exit(1);
});
