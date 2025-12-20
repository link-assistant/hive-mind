#!/usr/bin/env node

/**
 * Test script for /solve command reply feature
 * Tests the URL extraction logic from replied messages
 */

// Import the parseGitHubUrl function to test URL extraction logic
const { parseGitHubUrl } = await import('../src/github.lib.mjs');

console.log('===========================================');
console.log('Testing /solve Reply Feature');
console.log('===========================================\n');

/**
 * Extract GitHub issue/PR URL from message text
 * (Copied from telegram-bot.mjs for testing)
 */
function extractGitHubUrl(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // Split text into words and check each one
  const words = text.split(/\s+/);

  for (const word of words) {
    // Try to parse as GitHub URL
    const parsed = parseGitHubUrl(word);

    // Accept issue or PR URLs
    if (parsed.valid && (parsed.type === 'issue' || parsed.type === 'pull')) {
      return parsed.normalized;
    }
  }

  return null;
}

// Test cases for URL extraction
const testCases = [
  {
    desc: 'Plain issue URL',
    text: 'https://github.com/link-assistant/hive-mind/issues/603',
    expected: 'https://github.com/link-assistant/hive-mind/issues/603'
  },
  {
    desc: 'Issue URL in a sentence',
    text: 'Check out this issue https://github.com/owner/repo/issues/123 please',
    expected: 'https://github.com/owner/repo/issues/123'
  },
  {
    desc: 'Pull request URL',
    text: 'Here is the PR: https://github.com/owner/repo/pull/456',
    expected: 'https://github.com/owner/repo/pull/456'
  },
  {
    desc: 'Shorthand issue format',
    text: 'owner/repo/issues/789',
    expected: 'https://github.com/owner/repo/issues/789'
  },
  {
    desc: 'Multiple URLs (should return first valid one)',
    text: 'Check https://github.com/owner/repo/issues/1 and https://github.com/owner/repo/issues/2',
    expected: 'https://github.com/owner/repo/issues/1'
  },
  {
    desc: 'No GitHub URL',
    text: 'This is just a regular message without any links',
    expected: null
  },
  {
    desc: 'GitHub repo URL (not issue/PR)',
    text: 'https://github.com/owner/repo',
    expected: null
  },
  {
    desc: 'Empty text',
    text: '',
    expected: null
  },
  {
    desc: 'Issue URL with query params',
    text: 'https://github.com/owner/repo/issues/100?foo=bar',
    expected: 'https://github.com/owner/repo/issues/100?foo=bar'
  },
  {
    desc: 'HTTP protocol (should normalize to HTTPS)',
    text: 'http://github.com/owner/repo/issues/200',
    expected: 'https://github.com/owner/repo/issues/200'
  }
];

console.log('Running URL extraction tests:\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = extractGitHubUrl(testCase.text);
  const success = result === testCase.expected;

  if (success) {
    passed++;
    console.log(`✅ PASS: ${testCase.desc}`);
  } else {
    failed++;
    console.log(`❌ FAIL: ${testCase.desc}`);
    console.log(`   Input:    "${testCase.text}"`);
    console.log(`   Expected: ${testCase.expected}`);
    console.log(`   Got:      ${result}`);
  }
}

console.log('\n===========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('===========================================\n');

if (failed > 0) {
  process.exit(1);
}

console.log('✅ All tests passed!');
