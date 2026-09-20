#!/usr/bin/env node

/**
 * Test suite for lenv-reader.lib.mjs
 * Tests LINO-based environment configuration reading
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the lenv-reader library
const lenvReaderModule = await import('../src/lenv-reader.lib.mjs');
const { LenvReader, lenvReader, loadLenvConfig } = lenvReaderModule;

let testsPassed = 0;
let testsFailed = 0;
const pendingTests = [];

function runTest(name, testFn) {
  const testPromise = (async () => {
    process.stdout.write(`Testing ${name}... `);
    try {
      await testFn();
      console.log('✅ PASSED');
      testsPassed++;
    } catch (error) {
      console.log(`❌ FAILED: ${error.message}`);
      testsFailed++;
    }
  })();
  pendingTests.push(testPromise);
  return testPromise;
}

// Test 1: LenvReader class is exported
runTest('LenvReader class export', () => {
  if (!LenvReader) {
    throw new Error('LenvReader class not exported');
  }
  if (typeof LenvReader !== 'function') {
    throw new Error('LenvReader is not a constructor function');
  }
});

// Test 2: lenvReader singleton is exported
runTest('lenvReader singleton export', () => {
  if (!lenvReader) {
    throw new Error('lenvReader singleton not exported');
  }
  if (!(lenvReader instanceof LenvReader)) {
    throw new Error('lenvReader is not an instance of LenvReader');
  }
});

// Test 3: loadLenvConfig function is exported
runTest('loadLenvConfig function export', () => {
  if (!loadLenvConfig) {
    throw new Error('loadLenvConfig function not exported');
  }
  if (typeof loadLenvConfig !== 'function') {
    throw new Error('loadLenvConfig is not a function');
  }
});

// Test 4: Parse simple LINO configuration
runTest('parse simple LINO configuration', () => {
  const reader = new LenvReader();
  const config = `VAR1: 1
VAR2: 2`;

  const result = reader.parse(config);

  if (!result.VAR1 || result.VAR1 !== '1') {
    throw new Error(`Expected VAR1 to be '1', got '${result.VAR1}'`);
  }
  if (!result.VAR2 || result.VAR2 !== '2') {
    throw new Error(`Expected VAR2 to be '2', got '${result.VAR2}'`);
  }
});

// Test 5: Parse LINO configuration with list
runTest('parse LINO configuration with list', () => {
  const reader = new LenvReader();
  const config = `LINO_LIST: (
  1
  2
  3
)`;

  const result = reader.parse(config);

  if (!result.LINO_LIST) {
    throw new Error('LINO_LIST not found in result');
  }

  // Should format as LINO notation
  if (!result.LINO_LIST.includes('1') || !result.LINO_LIST.includes('2') || !result.LINO_LIST.includes('3')) {
    throw new Error(`Expected LINO_LIST to contain 1, 2, 3, got '${result.LINO_LIST}'`);
  }
});

// Test 6: Parse empty configuration
runTest('parse empty configuration', () => {
  const reader = new LenvReader();
  const result = reader.parse('');

  if (Object.keys(result).length !== 0) {
    throw new Error('Expected empty result for empty configuration');
  }
});

// Test 7: Parse null configuration
runTest('parse null configuration', () => {
  const reader = new LenvReader();
  const result = reader.parse(null);

  if (Object.keys(result).length !== 0) {
    throw new Error('Expected empty result for null configuration');
  }
});

// Test 8: Read .lenv file
runTest('read .lenv file', async () => {
  const reader = new LenvReader();
  const testFile = join(__dirname, '.test-lenv-file');

  // Create test file
  const testContent = `TEST_VAR: test_value
TEST_VAR2: 123`;
  writeFileSync(testFile, testContent);

  try {
    const result = await reader.readFile(testFile);

    if (!result) {
      throw new Error('readFile returned null');
    }

    if (result.TEST_VAR !== 'test_value') {
      throw new Error(`Expected TEST_VAR to be 'test_value', got '${result.TEST_VAR}'`);
    }

    if (result.TEST_VAR2 !== '123') {
      throw new Error(`Expected TEST_VAR2 to be '123', got '${result.TEST_VAR2}'`);
    }
  } finally {
    // Clean up
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  }
});

// Test 9: Read non-existent file
runTest('read non-existent file', async () => {
  const reader = new LenvReader();
  const result = await reader.readFile('/non/existent/file.lenv');

  if (result !== null) {
    throw new Error('Expected null for non-existent file');
  }
});

// Test 10: config() method with configuration string
runTest('config() with configuration string', async () => {
  const reader = new LenvReader();

  // Save original env vars
  const originalVar1 = process.env.TEST_CONFIG_VAR1;
  const originalVar2 = process.env.TEST_CONFIG_VAR2;

  try {
    const config = `TEST_CONFIG_VAR1: value1
TEST_CONFIG_VAR2: value2`;

    const result = await reader.config({
      configuration: config,
      override: true,
      quiet: true,
    });

    if (result.TEST_CONFIG_VAR1 !== 'value1') {
      throw new Error(`Expected TEST_CONFIG_VAR1 to be 'value1', got '${result.TEST_CONFIG_VAR1}'`);
    }

    if (process.env.TEST_CONFIG_VAR1 !== 'value1') {
      throw new Error('TEST_CONFIG_VAR1 not set in process.env');
    }

    if (process.env.TEST_CONFIG_VAR2 !== 'value2') {
      throw new Error('TEST_CONFIG_VAR2 not set in process.env');
    }
  } finally {
    // Restore original env vars
    if (originalVar1 !== undefined) {
      process.env.TEST_CONFIG_VAR1 = originalVar1;
    } else {
      delete process.env.TEST_CONFIG_VAR1;
    }
    if (originalVar2 !== undefined) {
      process.env.TEST_CONFIG_VAR2 = originalVar2;
    } else {
      delete process.env.TEST_CONFIG_VAR2;
    }
  }
});

// Test 11: config() method with file
runTest('config() with file', async () => {
  const reader = new LenvReader();
  const testFile = join(__dirname, '.test-config-lenv');

  // Save original env vars
  const originalVar = process.env.TEST_FILE_VAR;

  try {
    // Create test file
    const testContent = `TEST_FILE_VAR: file_value`;
    writeFileSync(testFile, testContent);

    const result = await reader.config({
      path: testFile,
      override: true,
      quiet: true,
    });

    if (result.TEST_FILE_VAR !== 'file_value') {
      throw new Error(`Expected TEST_FILE_VAR to be 'file_value', got '${result.TEST_FILE_VAR}'`);
    }

    if (process.env.TEST_FILE_VAR !== 'file_value') {
      throw new Error('TEST_FILE_VAR not set in process.env');
    }
  } finally {
    // Clean up
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
    if (originalVar !== undefined) {
      process.env.TEST_FILE_VAR = originalVar;
    } else {
      delete process.env.TEST_FILE_VAR;
    }
  }
});

// Test 12: config() respects override flag
runTest('config() respects override flag', async () => {
  const reader = new LenvReader();

  // Set existing env var
  process.env.TEST_OVERRIDE_VAR = 'original';

  try {
    const config = `TEST_OVERRIDE_VAR: new_value`;

    // First try without override
    await reader.config({
      configuration: config,
      override: false,
      quiet: true,
    });

    if (process.env.TEST_OVERRIDE_VAR !== 'original') {
      throw new Error('override: false should not override existing vars');
    }

    // Now try with override
    await reader.config({
      configuration: config,
      override: true,
      quiet: true,
    });

    if (process.env.TEST_OVERRIDE_VAR !== 'new_value') {
      throw new Error('override: true should override existing vars');
    }
  } finally {
    // Clean up
    delete process.env.TEST_OVERRIDE_VAR;
  }
});

// Test 13: shouldUseLenv() method
runTest('shouldUseLenv() method', async () => {
  const reader = new LenvReader();
  const testLenvFile = join(__dirname, '.test-should-use.lenv');
  const testEnvFile = join(__dirname, '.test-should-use.env');

  try {
    // Create .lenv file
    writeFileSync(testLenvFile, 'TEST: value');

    const shouldUse = await reader.shouldUseLenv(testLenvFile, testEnvFile);

    if (!shouldUse) {
      throw new Error('shouldUseLenv should return true when .lenv exists');
    }
  } finally {
    // Clean up
    if (existsSync(testLenvFile)) {
      unlinkSync(testLenvFile);
    }
  }
});

// Test 14: shouldUseLenv() returns false when .lenv doesn't exist
runTest('shouldUseLenv() returns false when no .lenv', async () => {
  const reader = new LenvReader();
  const testLenvFile = join(__dirname, '.test-no-lenv.lenv');
  const testEnvFile = join(__dirname, '.test-no-lenv.env');

  const shouldUse = await reader.shouldUseLenv(testLenvFile, testEnvFile);

  if (shouldUse) {
    throw new Error('shouldUseLenv should return false when .lenv does not exist');
  }
});

// Test 15: Parse configuration with --configuration option format
runTest('parse --configuration option format', () => {
  const reader = new LenvReader();
  const config = `VAR1: 1
VAR2: 2
LINO_LIST: (
  1
  2
  3
)`;

  const result = reader.parse(config);

  if (result.VAR1 !== '1') {
    throw new Error(`Expected VAR1 to be '1', got '${result.VAR1}'`);
  }

  if (result.VAR2 !== '2') {
    throw new Error(`Expected VAR2 to be '2', got '${result.VAR2}'`);
  }

  if (!result.LINO_LIST) {
    throw new Error('LINO_LIST not found in result');
  }
});

// Test 16: loadLenvConfig function
runTest('loadLenvConfig function', async () => {
  // Save original env var
  const originalVar = process.env.TEST_LOAD_VAR;

  try {
    const result = await loadLenvConfig({
      configuration: 'TEST_LOAD_VAR: loaded',
      override: true,
      quiet: true,
    });

    if (result.TEST_LOAD_VAR !== 'loaded') {
      throw new Error(`Expected TEST_LOAD_VAR to be 'loaded', got '${result.TEST_LOAD_VAR}'`);
    }

    if (process.env.TEST_LOAD_VAR !== 'loaded') {
      throw new Error('TEST_LOAD_VAR not set in process.env by loadLenvConfig');
    }
  } finally {
    // Clean up
    if (originalVar !== undefined) {
      process.env.TEST_LOAD_VAR = originalVar;
    } else {
      delete process.env.TEST_LOAD_VAR;
    }
  }
});

// ===============================================
// Validation Tests (Issue #1086)
// ===============================================

// Test 17: Accept bare same-line option/value links
runTest('accept bare same-line option/value links', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_HIVE_OVERRIDES:
  --option1
  --option2 value3`;

  const result = reader.parse(config);
  const expected = `(
  --option1
  --option2
  value3
)`;

  if (result.TELEGRAM_HIVE_OVERRIDES !== expected) {
    throw new Error(`Expected flattened bare option/value link, got: ${result.TELEGRAM_HIVE_OVERRIDES}`);
  }
});

// Test 18: Bare and parenthesized option/value links parse identically
runTest('parse bare and parenthesized option/value links identically', () => {
  const reader = new LenvReader();
  const bare = `TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  --verbose
  --no-tool-check
  --disable-report-issue
  --isolation docker`;
  const parenthesized = `TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  --verbose
  --no-tool-check
  --disable-report-issue
  (--isolation docker)`;

  const bareResult = reader.parse(bare);
  const parenthesizedResult = reader.parse(parenthesized);

  if (bareResult.TELEGRAM_SOLVE_OVERRIDES !== parenthesizedResult.TELEGRAM_SOLVE_OVERRIDES) {
    throw new Error(`Expected bare and parenthesized overrides to match.\nBare: ${bareResult.TELEGRAM_SOLVE_OVERRIDES}\nParenthesized: ${parenthesizedResult.TELEGRAM_SOLVE_OVERRIDES}`);
  }
});

// Test 19: Reject invalid character ? in options
runTest('reject invalid character ? in options', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_HIVE_OVERRIDES:
  --auto-resume-on-limit-reset?
  --verbose`;

  let errorThrown = false;
  let errorMessage = '';
  try {
    reader.parse(config);
  } catch (error) {
    errorThrown = true;
    errorMessage = error.message;
  }

  if (!errorThrown) {
    throw new Error('Expected error for invalid character ?, but no error was thrown');
  }

  if (!errorMessage.includes('Unrecognized character "?"')) {
    throw new Error(`Expected 'Unrecognized character "?"' error, got: ${errorMessage}`);
  }
});

// Test 20: Reject invalid character @ in options
runTest('reject invalid character @ in options', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_HIVE_OVERRIDES:
  --option@name`;

  let errorThrown = false;
  let errorMessage = '';
  try {
    reader.parse(config);
  } catch (error) {
    errorThrown = true;
    errorMessage = error.message;
  }

  if (!errorThrown) {
    throw new Error('Expected error for invalid character @, but no error was thrown');
  }

  if (!errorMessage.includes('Unrecognized character "@"')) {
    throw new Error(`Expected 'Unrecognized character "@"' error, got: ${errorMessage}`);
  }
});

// Test 21: Accept valid options with = sign
runTest('accept valid options with = sign', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_HIVE_OVERRIDES:
  --model=opus
  --verbose`;

  const result = reader.parse(config);

  if (!result.TELEGRAM_HIVE_OVERRIDES) {
    throw new Error('TELEGRAM_HIVE_OVERRIDES not found in result');
  }

  if (!result.TELEGRAM_HIVE_OVERRIDES.includes('--model=opus')) {
    throw new Error('Expected --model=opus to be preserved');
  }
});

// Test 22: Accept valid hyphenated options
runTest('accept valid hyphenated options', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_HIVE_OVERRIDES:
  --auto-resume-on-limit-reset
  --skip-issues-with-prs`;

  const result = reader.parse(config);

  if (!result.TELEGRAM_HIVE_OVERRIDES) {
    throw new Error('TELEGRAM_HIVE_OVERRIDES not found in result');
  }

  if (!result.TELEGRAM_HIVE_OVERRIDES.includes('--auto-resume-on-limit-reset')) {
    throw new Error('Expected --auto-resume-on-limit-reset to be preserved');
  }
});

// Test 23: Non-option values should NOT be validated for special chars
runTest('non-option values are not validated', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_BOT_TOKEN: some-token-with-special!@#
TELEGRAM_ALLOWED_CHATS:
  -1002975819706
  1234567890`;

  // This should NOT throw - only option-like values starting with -- are validated
  const result = reader.parse(config);

  if (!result.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN not found');
  }
});

// Test 24: Accept explicit parenthesized lists
runTest('accept explicit parenthesized lists', () => {
  const reader = new LenvReader();
  const config = `LINO_LIST: (
  1
  2
  3
)`;

  // Parenthesized lists should be valid
  const result = reader.parse(config);

  if (!result.LINO_LIST) {
    throw new Error('LINO_LIST not found in result');
  }
});

// Test 25: Validation error message includes the problematic value
runTest('validation error message includes problematic value', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_HIVE_OVERRIDES:
  --problematic-option?with?multiple?marks`;

  let errorMessage = '';
  try {
    reader.parse(config);
  } catch (error) {
    errorMessage = error.message;
  }

  if (!errorMessage.includes('--problematic-option?with?multiple?marks')) {
    throw new Error(`Error message should include the problematic value, got: ${errorMessage}`);
  }
});

// Test 26: Accept parenthesized option/value links
runTest('accept parenthesized option/value links', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_HIVE_OVERRIDES:
  --verbose
  (--isolation screen)`;

  const result = reader.parse(config);
  const expected = `(
  --verbose
  --isolation
  screen
)`;

  if (result.TELEGRAM_HIVE_OVERRIDES !== expected) {
    throw new Error(`Expected flattened parenthesized option/value link, got: ${result.TELEGRAM_HIVE_OVERRIDES}`);
  }
});

// Test 27: Accept issue #1658 Telegram configuration shape
runTest('accept issue #1658 Telegram configuration shape', () => {
  const reader = new LenvReader();
  const config = `TELEGRAM_BOT_TOKEN: 'test-token'
TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  (--isolation screen)
TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  (--isolation screen)`;

  const result = reader.parse(config);

  if (result.TELEGRAM_BOT_TOKEN !== 'test-token') {
    throw new Error(`Expected TELEGRAM_BOT_TOKEN to be parsed, got: ${result.TELEGRAM_BOT_TOKEN}`);
  }
  if (!result.TELEGRAM_HIVE_OVERRIDES.includes('--isolation') || !result.TELEGRAM_HIVE_OVERRIDES.includes('screen')) {
    throw new Error(`Expected hive overrides to include flattened isolation args, got: ${result.TELEGRAM_HIVE_OVERRIDES}`);
  }
  if (!result.TELEGRAM_SOLVE_OVERRIDES.includes('--isolation') || !result.TELEGRAM_SOLVE_OVERRIDES.includes('screen')) {
    throw new Error(`Expected solve overrides to include flattened isolation args, got: ${result.TELEGRAM_SOLVE_OVERRIDES}`);
  }
});

// Summary
await Promise.all(pendingTests);

console.log('\n' + '='.repeat(50));
console.log(`Test Results for lenv-reader.lib.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
