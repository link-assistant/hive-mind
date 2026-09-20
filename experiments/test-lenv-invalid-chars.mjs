#!/usr/bin/env node

import { LenvReader } from '../src/lenv-reader.lib.mjs';

const lenvReader = new LenvReader();

// Test 1: Config with ? character in option
const configWithQuestionMark = `TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  --auto-resume-on-limit-reset?
  --tokens-budget-stats`;

console.log('=== Test 1: Option with ? character ===\n');
console.log('Expected: Error about unrecognized character ?\n');

try {
  const result = lenvReader.parse(configWithQuestionMark);
  console.log('UNEXPECTED: No error thrown!');
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.log('SUCCESS: Error correctly thrown');
  console.log('Error message:', error.message);
}

console.log('\n---\n');

// Test 2: Config with @ character in option
const configWithAtSign = `TELEGRAM_HIVE_OVERRIDES:
  --option@name`;

console.log('=== Test 2: Option with @ character ===\n');

try {
  const result = lenvReader.parse(configWithAtSign);
  console.log('UNEXPECTED: No error thrown!');
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.log('SUCCESS: Error correctly thrown');
  console.log('Error message:', error.message);
}

console.log('\n---\n');

// Test 3: Valid config with = for values
const configWithEquals = `TELEGRAM_HIVE_OVERRIDES:
  --model=opus
  --verbose
  --all-issues`;

console.log('=== Test 3: Valid option with = for values ===\n');

try {
  const result = lenvReader.parse(configWithEquals);
  console.log('SUCCESS: Config parsed correctly');
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.log('UNEXPECTED ERROR:', error.message);
}

console.log('\n---\n');

// Test 4: Non-option values should not trigger validation
const configWithNonOptions = `TELEGRAM_ALLOWED_CHATS:
  -1002975819706
  1234567890
TELEGRAM_BOT_TOKEN: some-token-with-special-chars!@#`;

console.log('=== Test 4: Non-option values (chat IDs, tokens) ===\n');
console.log('Expected: Should pass (only validates option-like values starting with --)\n');

try {
  const result = lenvReader.parse(configWithNonOptions);
  console.log('SUCCESS: Config parsed correctly');
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.log('Error:', error.message);
}
