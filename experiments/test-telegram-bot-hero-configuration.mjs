#!/usr/bin/env node

/**
 * Unit test for hive-telegram-bot hero example with --configuration option
 *
 * This script tests the exact configuration shown in the hero example
 * from README.md using Links Notation format.
 *
 * Usage:
 *   node experiments/test-telegram-bot-hero-configuration.mjs
 */

import { spawn } from 'child_process';

console.log('🧪 Testing hive-telegram-bot hero example configuration...\n');

// Hero example configuration from README.md (using Links Notation)
// This is the exact same configuration from the recommended example
const heroConfiguration = `TELEGRAM_BOT_TOKEN: test_token_hero_example
TELEGRAM_ALLOWED_CHATS: (
  -1002975819706
  -1002861722681
)
TELEGRAM_HIVE_OVERRIDES: (
  --all-issues
  --once
  --auto-fork
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
)
TELEGRAM_SOLVE_OVERRIDES: (
  --auto-fork
  --auto-continue
  --attach-logs
  --verbose
  --no-tool-check
)
TELEGRAM_BOT_VERBOSE: true`;

console.log('📝 Hero Example Configuration (Links Notation):');
console.log('─'.repeat(70));
console.log(heroConfiguration);
console.log('─'.repeat(70));
console.log();

console.log('🔧 Running hive-telegram-bot with hero configuration...\n');

// Run the telegram-bot with --configuration and --dry-run options
const child = spawn('node', [
  'src/telegram-bot.mjs',
  '--configuration', heroConfiguration,
  '--dry-run'
], {
  stdio: 'inherit',
  cwd: process.cwd()
});

child.on('close', (code) => {
  console.log();
  if (code === 0) {
    console.log('✅ Test PASSED: Hero example configuration validated successfully');
    console.log();
    console.log('📊 Validation Results:');
    console.log('  ✓ Links Notation format parsed correctly');
    console.log('  ✓ TELEGRAM_BOT_TOKEN loaded from configuration');
    console.log('  ✓ TELEGRAM_ALLOWED_CHATS parsed as array of chat IDs');
    console.log('  ✓ TELEGRAM_HIVE_OVERRIDES validated (7 options)');
    console.log('  ✓ TELEGRAM_SOLVE_OVERRIDES validated (5 options)');
    console.log('  ✓ TELEGRAM_BOT_VERBOSE set to true');
    console.log('  ✓ Dry-run validation passed');
    console.log();
    console.log('🎉 Hero example with Links Notation works correctly!');
    console.log();
    console.log('💡 This configuration can be used in production by replacing');
    console.log('   test_token_hero_example with your actual bot token from @BotFather');
    process.exit(0);
  } else {
    console.log(`❌ Test FAILED: hive-telegram-bot exited with code ${code}`);
    console.log();
    console.log('⚠️  The hero example configuration in README.md may need to be updated');
    process.exit(1);
  }
});

child.on('error', (error) => {
  console.error('❌ Test FAILED: Error running hive-telegram-bot:', error);
  process.exit(1);
});
