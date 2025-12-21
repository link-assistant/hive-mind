#!/usr/bin/env node

/**
 * Test suite for backslash validation in URLs (Issue #923)
 * Tests the enhanced parseGitHubUrl function to detect and suggest fixes for backslashes
 */

// Import the parseGitHubUrl function
const { parseGitHubUrl } = await import('../src/github.lib.mjs');

console.log('===========================================');
console.log('Test Suite: Backslash URL Validation (#923)');
console.log('===========================================\n');

// Test cases for URLs with backslashes (should fail with suggestion)
const backslashTests = [
  {
    desc: 'Trailing backslash at end of URL',
    url: 'https://github.com/konard/hh-job-application-automation/issues/124\\',
    shouldPass: false,
    expectedError: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
    expectedSuggestion: 'https://github.com/konard/hh-job-application-automation/issues/124/'
  },
  {
    desc: 'Backslash in path (middle)',
    url: 'https://github.com/owner\\repo/issues/123',
    shouldPass: false,
    expectedError: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
    expectedSuggestion: 'https://github.com/owner/repo/issues/123'
  },
  {
    desc: 'Multiple backslashes in path',
    url: 'https://github.com\\owner\\repo\\issues\\123',
    shouldPass: false,
    expectedError: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
    expectedSuggestion: 'https://github.com/owner/repo/issues/123'
  },
  {
    desc: 'Backslash before domain (shorthand format)',
    url: 'owner\\repo/issues/123',
    shouldPass: false,
    expectedError: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
    expectedSuggestion: 'https://github.com/owner/repo/issues/123'
  },
  {
    desc: 'Backslash at end with no trailing content',
    url: 'https://github.com/owner/repo\\',
    shouldPass: false,
    expectedError: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
    expectedSuggestion: 'https://github.com/owner/repo/'
  }
];

// Test cases for URLs with backslashes in query/hash (should still fail but different handling)
const queryHashBackslashTests = [
  {
    desc: 'Backslash in query parameter',
    url: 'https://github.com/owner/repo/issues/123?q=test\\value',
    shouldPass: true, // Query params are allowed to have backslashes
    note: 'Query params can contain backslashes'
  },
  {
    desc: 'Backslash in hash fragment',
    url: 'https://github.com/owner/repo/issues/123#L\\123',
    shouldPass: true, // Hash fragments are allowed to have backslashes
    note: 'Hash fragments can contain backslashes'
  }
];

// Test cases for valid URLs (should pass)
const validTests = [
  {
    desc: 'Valid issue URL',
    url: 'https://github.com/owner/repo/issues/123',
    shouldPass: true
  },
  {
    desc: 'Valid PR URL',
    url: 'https://github.com/owner/repo/pull/456',
    shouldPass: true
  },
  {
    desc: 'Valid URL with query params',
    url: 'https://github.com/owner/repo/issues/123?foo=bar',
    shouldPass: true
  },
  {
    desc: 'Valid URL with hash',
    url: 'https://github.com/owner/repo/issues/123#issuecomment-456',
    shouldPass: true
  },
  {
    desc: 'Valid shorthand URL',
    url: 'owner/repo/issues/123',
    shouldPass: true
  }
];

let passed = 0;
let failed = 0;

function runTest(testCase) {
  const result = parseGitHubUrl(testCase.url);
  const passedValidation = result.valid === testCase.shouldPass;

  let errorMatch = true;
  let suggestionMatch = true;

  if (!testCase.shouldPass) {
    errorMatch = !testCase.expectedError || result.error === testCase.expectedError;
    suggestionMatch = !testCase.expectedSuggestion || result.suggestion === testCase.expectedSuggestion;
  }

  const success = passedValidation && errorMatch && suggestionMatch;

  if (success) {
    passed++;
    console.log(`✅ PASS: ${testCase.desc}`);
    if (testCase.note) {
      console.log(`   Note: ${testCase.note}`);
    }
  } else {
    failed++;
    console.log(`❌ FAIL: ${testCase.desc}`);
    console.log(`   Input URL:       ${testCase.url}`);
    if (!passedValidation) {
      console.log(`   Expected valid:  ${testCase.shouldPass}`);
      console.log(`   Got valid:       ${result.valid}`);
    }
    if (!errorMatch) {
      console.log(`   Expected Error:  ${testCase.expectedError}`);
      console.log(`   Got Error:       ${result.error}`);
    }
    if (!suggestionMatch) {
      console.log(`   Expected Suggestion: ${testCase.expectedSuggestion}`);
      console.log(`   Got Suggestion:      ${result.suggestion}`);
    }
  }
}

console.log('Test Suite 1: URLs with Backslashes in Path (Should Fail)\n');
for (const testCase of backslashTests) {
  runTest(testCase);
}

console.log('\nTest Suite 2: URLs with Backslashes in Query/Hash (Should Pass)\n');
for (const testCase of queryHashBackslashTests) {
  runTest(testCase);
}

console.log('\nTest Suite 3: Valid URLs (Should Pass)\n');
for (const testCase of validTests) {
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
