#!/usr/bin/env node

/**
 * Experiment script to test lenv-reader functionality
 * This demonstrates how to use .lenv files and --configuration option
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the lenv-reader library
const lenvReaderModule = await import('../src/lenv-reader.lib.mjs');
const { LenvReader, loadLenvConfig } = lenvReaderModule;

console.log('🧪 Testing lenv-reader library\n');

// Experiment 1: Parse a simple LINO configuration
console.log('='.repeat(60));
console.log('Experiment 1: Parse simple LINO configuration');
console.log('='.repeat(60));

const reader = new LenvReader();
const simpleConfig = `VAR1: 1
VAR2: 2`;

console.log('Input:');
console.log(simpleConfig);
console.log('\nParsed result:');
const result1 = reader.parse(simpleConfig);
console.log(JSON.stringify(result1, null, 2));

// Experiment 2: Parse LINO configuration with list
console.log('\n' + '='.repeat(60));
console.log('Experiment 2: Parse LINO configuration with list');
console.log('='.repeat(60));

const listConfig = `LINO_LIST: (
  1
  2
  3
)`;

console.log('Input:');
console.log(listConfig);
console.log('\nParsed result:');
const result2 = reader.parse(listConfig);
console.log(JSON.stringify(result2, null, 2));

// Experiment 3: Parse complete .lenv example
console.log('\n' + '='.repeat(60));
console.log('Experiment 3: Parse complete .lenv example');
console.log('='.repeat(60));

const completeConfig = `VAR1: 1
VAR2: 2
LINO_LIST: (
  1
  2
  3
)`;

console.log('Input:');
console.log(completeConfig);
console.log('\nParsed result:');
const result3 = reader.parse(completeConfig);
console.log(JSON.stringify(result3, null, 2));

// Experiment 4: Test with .lenv file
console.log('\n' + '='.repeat(60));
console.log('Experiment 4: Read from .lenv file');
console.log('='.repeat(60));

const testFile = join(__dirname, '.test-experiment.lenv');
const fileContent = `TEST_VAR: test_value
TEST_VAR2: 123
TEST_LIST: (
  item1
  item2
  item3
)`;

console.log('Creating test file:', testFile);
console.log('Content:');
console.log(fileContent);

writeFileSync(testFile, fileContent);

console.log('\nReading file...');
const result4 = reader.readFile(testFile);
console.log('Parsed result:');
console.log(JSON.stringify(result4, null, 2));

// Clean up
unlinkSync(testFile);
console.log('\nCleaned up test file');

// Experiment 5: Test config() method with configuration string
console.log('\n' + '='.repeat(60));
console.log('Experiment 5: Use config() with --configuration option');
console.log('='.repeat(60));

// Save original env vars
const originalTestVar = process.env.EXPERIMENT_VAR;

const configString = `EXPERIMENT_VAR: from_config
EXPERIMENT_LIST: (
  option1
  option2
)`;

console.log('Configuration string:');
console.log(configString);

console.log('\nCalling config()...');
const result5 = loadLenvConfig({
  configuration: configString,
  override: true,
  quiet: false
});

console.log('\nLoaded variables:');
console.log(JSON.stringify(result5, null, 2));

console.log('\nEnvironment variables set:');
console.log('EXPERIMENT_VAR:', process.env.EXPERIMENT_VAR);
console.log('EXPERIMENT_LIST:', process.env.EXPERIMENT_LIST);

// Clean up
if (originalTestVar !== undefined) {
  process.env.EXPERIMENT_VAR = originalTestVar;
} else {
  delete process.env.EXPERIMENT_VAR;
}
delete process.env.EXPERIMENT_LIST;

// Experiment 6: Test with Telegram bot configuration
console.log('\n' + '='.repeat(60));
console.log('Experiment 6: Telegram bot configuration example');
console.log('='.repeat(60));

const telegramConfig = `TELEGRAM_BOT_TOKEN: your_bot_token_here
TELEGRAM_ALLOWED_CHATS: (
  123456789
  987654321
)
TELEGRAM_SOLVE_OVERRIDES: (
  --auto-continue
  --attach-logs
  --verbose
  --tool
  opencode
)`;

console.log('Configuration:');
console.log(telegramConfig);

console.log('\nParsed result:');
const result6 = reader.parse(telegramConfig);
console.log(JSON.stringify(result6, null, 2));

console.log('\n✅ All experiments completed successfully!');
