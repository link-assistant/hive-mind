#!/usr/bin/env node
/**
 * Test script for non-bot comment detection
 * Tests the isBot() logic used in solve.auto-merge.lib.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1190
 */

console.log('Testing non-bot comment detection logic...\n');

let allTestsPassed = true;

// Bot patterns to filter out
// Note: Patterns use word boundaries or end-of-string to avoid false positives
// (e.g., "claudeuser" should NOT match as a bot)
const botPatterns = [
  /\[bot\]$/i, // Any username ending with [bot]
  /^github-actions$/i, // GitHub Actions
  /^dependabot$/i, // Dependabot
  /^renovate$/i, // Renovate
  /^codecov$/i, // Codecov
  /^netlify$/i, // Netlify
  /^vercel$/i, // Vercel
  /^hive-?mind$/i, // Hive Mind (with or without hyphen)
  /^claude$/i, // Claude (exact match only)
  /^copilot$/i, // GitHub Copilot
];

const isBot = (login, currentUser = null) => {
  if (!login) return false;
  // Check if it's the current user (the bot running hive-mind)
  if (currentUser && login === currentUser) return true;
  // Check against known bot patterns
  return botPatterns.some(pattern => pattern.test(login));
};

// Test cases for known bots
const botTestCases = [
  { login: 'dependabot[bot]', expected: true, description: 'GitHub Dependabot' },
  { login: 'renovate[bot]', expected: true, description: 'Renovate bot' },
  { login: 'github-actions[bot]', expected: true, description: 'GitHub Actions bot' },
  { login: 'codecov[bot]', expected: true, description: 'Codecov bot' },
  { login: 'netlify[bot]', expected: true, description: 'Netlify bot' },
  { login: 'vercel[bot]', expected: true, description: 'Vercel bot' },
  { login: 'hive-mind', expected: true, description: 'Hive-mind bot' },
  { login: 'hivemind', expected: true, description: 'Hivemind bot (no hyphen)' },
  { login: 'claude', expected: true, description: 'Claude bot' },
  { login: 'copilot', expected: true, description: 'GitHub Copilot' },
  { login: 'custom-bot[bot]', expected: true, description: 'Any bot with [bot] suffix' },
  { login: 'my-app[bot]', expected: true, description: 'Custom app bot' },
];

// Test cases for regular users (should NOT be detected as bots)
const userTestCases = [
  { login: 'john-doe', expected: false, description: 'Regular user' },
  { login: 'developer123', expected: false, description: 'Regular developer' },
  { login: 'repo-owner', expected: false, description: 'Repository owner' },
  { login: 'code-reviewer', expected: false, description: 'Code reviewer' },
  { login: 'alice', expected: false, description: 'Simple username' },
  { login: 'bob_smith', expected: false, description: 'Username with underscore' },
  { login: 'claudeuser', expected: false, description: 'User with claude in name (should NOT match as bot)' },
  { login: 'mybotfriend', expected: false, description: 'User with bot in name (should NOT match as bot)' },
];

console.log('Test 1: Known bots should be detected');
for (const testCase of botTestCases) {
  const result = isBot(testCase.login);
  const passed = result === testCase.expected;

  if (passed) {
    console.log(`  ✅ ${testCase.description} (${testCase.login}): detected as bot = ${result}`);
  } else {
    console.log(`  ❌ ${testCase.description} (${testCase.login}): expected ${testCase.expected}, got ${result}`);
    allTestsPassed = false;
  }
}

console.log('\nTest 2: Regular users should NOT be detected as bots');
for (const testCase of userTestCases) {
  const result = isBot(testCase.login);
  const passed = result === testCase.expected;

  if (passed) {
    console.log(`  ✅ ${testCase.description} (${testCase.login}): detected as bot = ${result}`);
  } else {
    console.log(`  ❌ ${testCase.description} (${testCase.login}): expected ${testCase.expected}, got ${result}`);
    allTestsPassed = false;
  }
}

console.log('\nTest 3: Current user should be detected as bot (self-filtering)');
const currentUser = 'ai-issue-solver';
const selfTestCases = [
  { login: 'ai-issue-solver', expected: true, description: 'Current user (self)' },
  { login: 'other-user', expected: false, description: 'Different user' },
];

for (const testCase of selfTestCases) {
  const result = isBot(testCase.login, currentUser);
  const passed = result === testCase.expected;

  if (passed) {
    console.log(`  ✅ ${testCase.description} (${testCase.login}): detected as bot = ${result}`);
  } else {
    console.log(`  ❌ ${testCase.description} (${testCase.login}): expected ${testCase.expected}, got ${result}`);
    allTestsPassed = false;
  }
}

console.log('\nTest 4: Edge cases');
const edgeCases = [
  { login: null, expected: false, description: 'Null login' },
  { login: undefined, expected: false, description: 'Undefined login' },
  { login: '', expected: false, description: 'Empty string login' },
  { login: 'DEPENDABOT[BOT]', expected: true, description: 'Case insensitive (uppercase)' },
  { login: 'GitHub-Actions[bot]', expected: true, description: 'Case insensitive (mixed case)' },
];

for (const testCase of edgeCases) {
  const result = isBot(testCase.login);
  const passed = result === testCase.expected;

  if (passed) {
    console.log(`  ✅ ${testCase.description} (${testCase.login}): detected as bot = ${result}`);
  } else {
    console.log(`  ❌ ${testCase.description} (${testCase.login}): expected ${testCase.expected}, got ${result}`);
    allTestsPassed = false;
  }
}

// Summary
console.log('\n' + '='.repeat(60));
if (allTestsPassed) {
  console.log('✅ All tests PASSED!');
  process.exit(0);
} else {
  console.error('❌ Some tests FAILED!');
  process.exit(1);
}
