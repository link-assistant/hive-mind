#!/usr/bin/env node

/**
 * Unit tests for Telegram URL extraction feature
 * Tests the extractGitHubUrl function for /solve reply feature
 */

// Import the parseGitHubUrl function
const { parseGitHubUrl } = await import('../src/github.lib.mjs');

/**
 * Extract GitHub issue/PR URL from message text
 * Validates that message contains exactly one GitHub issue/PR link
 *
 * @param {string} text - Message text to search
 * @returns {{ url: string|null, error: string|null, linkCount: number }}
 */
function extractGitHubUrl(text) {
  if (!text || typeof text !== 'string') {
    return { url: null, error: null, linkCount: 0 };
  }

  // Split text into words and check each one
  const words = text.split(/\s+/);
  const foundUrls = [];

  for (const word of words) {
    // Try to parse as GitHub URL
    const parsed = parseGitHubUrl(word);

    // Accept issue or PR URLs
    if (parsed.valid && (parsed.type === 'issue' || parsed.type === 'pull')) {
      foundUrls.push(parsed.normalized);
    }
  }

  // Check if multiple links were found
  if (foundUrls.length === 0) {
    return { url: null, error: null, linkCount: 0 };
  } else if (foundUrls.length === 1) {
    return { url: foundUrls[0], error: null, linkCount: 1 };
  } else {
    return {
      url: null,
      error: `Found ${foundUrls.length} GitHub links in the message. Please reply to a message with only one GitHub issue or PR link.`,
      linkCount: foundUrls.length,
    };
  }
}

console.log('===========================================');
console.log('Unit Tests: Telegram URL Extraction');
console.log('===========================================\n');

// Test cases for single URL extraction
const singleLinkTests = [
  {
    desc: 'Plain issue URL',
    text: 'https://github.com/link-assistant/hive-mind/issues/603',
    expectedUrl: 'https://github.com/link-assistant/hive-mind/issues/603',
    expectedError: null,
    expectedCount: 1,
  },
  {
    desc: 'Issue URL in a sentence',
    text: 'Check out this issue https://github.com/owner/repo/issues/123 please',
    expectedUrl: 'https://github.com/owner/repo/issues/123',
    expectedError: null,
    expectedCount: 1,
  },
  {
    desc: 'Pull request URL',
    text: 'Here is the PR: https://github.com/owner/repo/pull/456',
    expectedUrl: 'https://github.com/owner/repo/pull/456',
    expectedError: null,
    expectedCount: 1,
  },
  {
    desc: 'Shorthand issue format',
    text: 'owner/repo/issues/789',
    expectedUrl: 'https://github.com/owner/repo/issues/789',
    expectedError: null,
    expectedCount: 1,
  },
  {
    desc: 'Issue URL with query params',
    text: 'https://github.com/owner/repo/issues/100?foo=bar',
    expectedUrl: 'https://github.com/owner/repo/issues/100?foo=bar',
    expectedError: null,
    expectedCount: 1,
  },
  {
    desc: 'HTTP protocol (should normalize to HTTPS)',
    text: 'http://github.com/owner/repo/issues/200',
    expectedUrl: 'https://github.com/owner/repo/issues/200',
    expectedError: null,
    expectedCount: 1,
  },
];

// Test cases for no URL
const noLinkTests = [
  {
    desc: 'No GitHub URL',
    text: 'This is just a regular message without any links',
    expectedUrl: null,
    expectedError: null,
    expectedCount: 0,
  },
  {
    desc: 'GitHub repo URL (not issue/PR)',
    text: 'https://github.com/owner/repo',
    expectedUrl: null,
    expectedError: null,
    expectedCount: 0,
  },
  {
    desc: 'Empty text',
    text: '',
    expectedUrl: null,
    expectedError: null,
    expectedCount: 0,
  },
  {
    desc: 'Null text',
    text: null,
    expectedUrl: null,
    expectedError: null,
    expectedCount: 0,
  },
];

// Test cases for multiple URLs (should return error)
const multipleLinkTests = [
  {
    desc: 'Two issue URLs',
    text: 'Check https://github.com/owner/repo/issues/1 and https://github.com/owner/repo/issues/2',
    expectedUrl: null,
    expectedError: 'Found 2 GitHub links in the message. Please reply to a message with only one GitHub issue or PR link.',
    expectedCount: 2,
  },
  {
    desc: 'Three PR URLs',
    text: 'PRs: https://github.com/a/b/pull/1 https://github.com/c/d/pull/2 https://github.com/e/f/pull/3',
    expectedUrl: null,
    expectedError: 'Found 3 GitHub links in the message. Please reply to a message with only one GitHub issue or PR link.',
    expectedCount: 3,
  },
  {
    desc: 'Mixed issue and PR URLs',
    text: 'Issue: https://github.com/owner/repo/issues/10 PR: https://github.com/owner/repo/pull/20',
    expectedUrl: null,
    expectedError: 'Found 2 GitHub links in the message. Please reply to a message with only one GitHub issue or PR link.',
    expectedCount: 2,
  },
];

let passed = 0;
let failed = 0;

function runTest(testCase) {
  const result = extractGitHubUrl(testCase.text);
  const urlMatch = result.url === testCase.expectedUrl;
  const errorMatch = result.error === testCase.expectedError;
  const countMatch = result.linkCount === testCase.expectedCount;
  const success = urlMatch && errorMatch && countMatch;

  if (success) {
    passed++;
    console.log(`✅ PASS: ${testCase.desc}`);
  } else {
    failed++;
    console.log(`❌ FAIL: ${testCase.desc}`);
    console.log(`   Input:           "${testCase.text}"`);
    if (!urlMatch) {
      console.log(`   Expected URL:    ${testCase.expectedUrl}`);
      console.log(`   Got URL:         ${result.url}`);
    }
    if (!errorMatch) {
      console.log(`   Expected Error:  ${testCase.expectedError}`);
      console.log(`   Got Error:       ${result.error}`);
    }
    if (!countMatch) {
      console.log(`   Expected Count:  ${testCase.expectedCount}`);
      console.log(`   Got Count:       ${result.linkCount}`);
    }
  }
}

console.log('Test Suite 1: Single Link Extraction\n');
for (const testCase of singleLinkTests) {
  runTest(testCase);
}

console.log('\nTest Suite 2: No Link Found\n');
for (const testCase of noLinkTests) {
  runTest(testCase);
}

console.log('\nTest Suite 3: Multiple Links (Error Cases)\n');
for (const testCase of multipleLinkTests) {
  runTest(testCase);
}

console.log('\n===========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('===========================================\n');

if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
}

console.log('✅ All tests passed!');
