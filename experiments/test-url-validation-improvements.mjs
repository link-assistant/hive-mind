#!/usr/bin/env node
/**
 * Test script for URL validation improvements (Issue #1070)
 * Tests that error messages are helpful and specific
 */

import { parseGitHubUrl } from '../src/github.lib.mjs';

// Import the validation function (we'll need to extract it or test it indirectly)
function validateGitHubUrl(args, options = {}) {
  const { allowedTypes = ['issue', 'pull'], commandName = 'solve' } = options;

  if (args.length === 0) {
    return {
      valid: false,
      error: `Missing GitHub URL. Usage: /${commandName} <github-url> [options]`,
    };
  }

  const url = args[0];
  if (!url.includes('github.com')) {
    return {
      valid: false,
      error: 'First argument must be a GitHub URL',
    };
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) {
    return {
      valid: false,
      error: parsed.error || 'Invalid GitHub URL',
      suggestion: parsed.suggestion,
    };
  }

  if (!allowedTypes.includes(parsed.type)) {
    const allowedTypesStr = allowedTypes.map(t => (t === 'pull' ? 'pull request' : t)).join(', ');

    let error;
    let specificHelp = '';

    if (parsed.type === 'issues_list') {
      error = `URL points to the issues list page, but you need a specific issue`;
      specificHelp = `\n\n💡 How to fix:\n` + `1. Open the repository: ${url}\n` + `2. Click on a specific issue\n` + `3. Copy the URL (it should end with /issues/NUMBER)\n\n` + `Example: \`https://github.com/${parsed.owner}/${parsed.repo}/issues/1\``;
    } else if (parsed.type === 'pulls_list') {
      error = `URL points to the pull requests list page, but you need a specific pull request`;
      specificHelp = `\n\n💡 How to fix:\n` + `1. Open the repository: ${url}\n` + `2. Click on a specific pull request\n` + `3. Copy the URL (it should end with /pull/NUMBER)\n\n` + `Example: \`https://github.com/${parsed.owner}/${parsed.repo}/pull/1\``;
    } else if (parsed.type === 'repo') {
      error = `URL points to a repository, but you need a specific ${allowedTypesStr}`;
      specificHelp = `\n\n💡 How to fix:\n` + `1. Go to: ${url}/issues\n` + `2. Click on an issue to solve\n` + `3. Use the full URL with the issue number\n\n` + `Example: \`https://github.com/${parsed.owner}/${parsed.repo}/issues/1\``;
    } else {
      error = `URL must be a GitHub ${allowedTypesStr} (not ${parsed.type.replace('_', ' ')})`;
    }

    return {
      valid: false,
      error: error + specificHelp,
    };
  }

  return { valid: true };
}

console.log('🧪 Testing URL validation improvements for Issue #1070\n');

const testCases = [
  {
    name: 'Issues list page (the original problem from issue #1070)',
    url: 'https://github.com/Andreymazo/Posutochka_Fastapi/issues',
    shouldFail: true,
    expectedInError: ['issues list page', 'specific issue', 'How to fix'],
  },
  {
    name: 'Valid issue URL',
    url: 'https://github.com/Andreymazo/Posutochka_Fastapi/issues/1',
    shouldFail: false,
  },
  {
    name: 'Valid PR URL',
    url: 'https://github.com/owner/repo/pull/123',
    shouldFail: false,
  },
  {
    name: 'Pull requests list page',
    url: 'https://github.com/owner/repo/pulls',
    shouldFail: true,
    expectedInError: ['pull requests list', 'specific pull request', 'How to fix'],
  },
  {
    name: 'Repository URL (no issue)',
    url: 'https://github.com/owner/repo',
    shouldFail: true,
    expectedInError: ['repository', 'specific', 'How to fix'],
  },
  {
    name: 'Actions page',
    url: 'https://github.com/owner/repo/actions',
    shouldFail: true,
    expectedInError: ['must be'],
  },
];

let passed = 0;
let failed = 0;

for (const test of testCases) {
  console.log(`\n📋 Test: ${test.name}`);
  console.log(`   URL: ${test.url}`);

  const result = validateGitHubUrl([test.url]);

  if (test.shouldFail) {
    if (!result.valid) {
      // Check if error contains expected strings
      let allExpectedFound = true;
      const missingExpected = [];

      if (test.expectedInError) {
        for (const expected of test.expectedInError) {
          if (!result.error.includes(expected)) {
            allExpectedFound = false;
            missingExpected.push(expected);
          }
        }
      }

      if (allExpectedFound) {
        console.log(`   ✅ PASS - Correctly rejected with helpful error`);
        console.log(
          `   Error message:\n${result.error
            .split('\n')
            .map(l => `      ${l}`)
            .join('\n')}`
        );
        passed++;
      } else {
        console.log(`   ❌ FAIL - Error message missing expected content: ${missingExpected.join(', ')}`);
        console.log(
          `   Actual error:\n${result.error
            .split('\n')
            .map(l => `      ${l}`)
            .join('\n')}`
        );
        failed++;
      }
    } else {
      console.log(`   ❌ FAIL - Should have failed but passed validation`);
      failed++;
    }
  } else {
    if (result.valid) {
      console.log(`   ✅ PASS - Correctly accepted`);
      passed++;
    } else {
      console.log(`   ❌ FAIL - Should have passed but was rejected`);
      console.log(`   Error: ${result.error}`);
      failed++;
    }
  }
}

console.log(`\n\n📊 Test Results:`);
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   Total: ${passed + failed}`);

if (failed === 0) {
  console.log(`\n🎉 All tests passed!`);
  process.exit(0);
} else {
  console.log(`\n⚠️  Some tests failed`);
  process.exit(1);
}
