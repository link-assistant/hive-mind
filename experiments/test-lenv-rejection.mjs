#!/usr/bin/env node

import { LenvReader } from '../src/lenv-reader.lib.mjs';

const lenvReader = new LenvReader();

// Test the exact config from the issue - should fail
const issueConfigBad = `TELEGRAM_BOT_TOKEN: '849...55:AA...gk_YZ...PU'
TELEGRAM_ALLOWED_CHATS:
  -1002975819706
  -1002861722681
TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset?  --tokens-budget-stats
TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
TELEGRAM_BOT_VERBOSE: true`;

console.log('=== Test 1: Invalid config (same-line options) ===\n');
console.log('Expected: Error should be thrown\n');

try {
  const result = lenvReader.parse(issueConfigBad);
  console.log('UNEXPECTED: No error thrown!');
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.log('SUCCESS: Error correctly thrown');
  console.log('Error message:', error.message);
}

console.log('\n---\n');

// Test valid config - should succeed
const issueConfigGood = `TELEGRAM_BOT_TOKEN: '849...55:AA...gk_YZ...PU'
TELEGRAM_ALLOWED_CHATS:
  -1002975819706
  -1002861722681
TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
TELEGRAM_BOT_VERBOSE: true`;

console.log('=== Test 2: Valid config (each option on its own line) ===\n');
console.log('Expected: Should succeed\n');

try {
  const result = lenvReader.parse(issueConfigGood);
  console.log('SUCCESS: Config parsed correctly');
  console.log('TELEGRAM_HIVE_OVERRIDES:', result['TELEGRAM_HIVE_OVERRIDES']);
} catch (error) {
  console.log('UNEXPECTED ERROR:', error.message);
}
