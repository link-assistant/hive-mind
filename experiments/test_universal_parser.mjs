#!/usr/bin/env node

// Test script for the universal GitHub URL parser
import { parseGitHubUrl, normalizeGitHubUrl, isGitHubUrlType } from '../src/github.lib.mjs';

console.log('===========================================');
console.log('Testing Universal GitHub URL Parser');
console.log('===========================================\n');

// Test cases for various GitHub URL formats
const testCases = [
  // Basic user/org and repo URLs
  { url: 'https://github.com/konard', desc: 'Standard user URL' },
  { url: 'http://github.com/konard', desc: 'HTTP user URL (should convert to HTTPS)' },
  { url: 'github.com/konard', desc: 'Protocol-less user URL' },
  { url: 'konard', desc: 'Shorthand user' },
  { url: 'https://github.com/konard/test-repo', desc: 'Standard repo URL' },
  { url: 'http://github.com/konard/test-repo', desc: 'HTTP repo URL' },
  { url: 'github.com/konard/test-repo', desc: 'Protocol-less repo URL' },
  { url: 'konard/test-repo', desc: 'Shorthand repo' },

  // Issue URLs
  { url: 'https://github.com/owner/repo/issues/123', desc: 'Standard issue URL' },
  { url: 'http://github.com/owner/repo/issues/123', desc: 'HTTP issue URL' },
  { url: 'github.com/owner/repo/issues/123', desc: 'Protocol-less issue URL' },
  { url: 'owner/repo/issues/123', desc: 'Shorthand issue' },

  // Pull request URLs
  { url: 'https://github.com/owner/repo/pull/456', desc: 'Standard PR URL' },
  { url: 'http://github.com/owner/repo/pull/456', desc: 'HTTP PR URL' },
  { url: 'github.com/owner/repo/pull/456', desc: 'Protocol-less PR URL' },
  { url: 'owner/repo/pull/456', desc: 'Shorthand PR' },

  // Other GitHub URL types
  { url: 'https://github.com/owner/repo/actions', desc: 'Actions URL' },
  { url: 'https://github.com/owner/repo/releases', desc: 'Releases URL' },
  { url: 'https://github.com/owner/repo/wiki', desc: 'Wiki URL' },
  { url: 'https://github.com/owner/repo/tree/main', desc: 'Tree/branch URL' },
  { url: 'https://github.com/owner/repo/blob/main/README.md', desc: 'File URL' },

  // Invalid URLs
  { url: 'not a valid url!', desc: 'Invalid URL with special chars' },
  { url: 'https://gitlab.com/owner/repo', desc: 'Non-GitHub URL' },
  { url: '', desc: 'Empty string' },
  { url: null, desc: 'Null value' }
];

console.log('Testing parseGitHubUrl function:');
console.log('---------------------------------\n');

for (const testCase of testCases) {
  console.log(`Test: ${testCase.desc}`);
  console.log(`Input: ${testCase.url}`);

  const result = parseGitHubUrl(testCase.url);

  if (result.valid) {
    console.log(`✅ Valid URL`);
    console.log(`  Type: ${result.type}`);
    console.log(`  Normalized: ${result.normalized}`);
    if (result.owner) console.log(`  Owner: ${result.owner}`);
    if (result.repo) console.log(`  Repo: ${result.repo}`);
    if (result.number) console.log(`  Number: ${result.number}`);
  } else {
    console.log(`❌ Invalid URL`);
    if (result.error) console.log(`  Error: ${result.error}`);
  }
  console.log('');
}

console.log('\n===========================================');
console.log('Testing normalizeGitHubUrl function:');
console.log('---------------------------------\n');

const urlsToNormalize = [
  'http://github.com/konard',
  'github.com/konard',
  'konard',
  'konard/repo',
  'owner/repo/issues/123',
  'not valid!'
];

for (const url of urlsToNormalize) {
  const normalized = normalizeGitHubUrl(url);
  console.log(`Input:  ${url}`);
  console.log(`Output: ${normalized || 'null (invalid)'}`);
  console.log('');
}

console.log('\n===========================================');
console.log('Testing isGitHubUrlType function:');
console.log('---------------------------------\n');

const typeTests = [
  { url: 'https://github.com/owner', types: 'user', expected: true },
  { url: 'https://github.com/owner/repo', types: 'repo', expected: true },
  { url: 'https://github.com/owner/repo/issues/123', types: 'issue', expected: true },
  { url: 'https://github.com/owner/repo/pull/456', types: 'pull', expected: true },
  { url: 'https://github.com/owner/repo/issues/123', types: ['issue', 'pull'], expected: true },
  { url: 'https://github.com/owner/repo/pull/456', types: ['issue', 'pull'], expected: true },
  { url: 'https://github.com/owner/repo', types: 'issue', expected: false },
  { url: 'not valid', types: 'user', expected: false }
];

for (const test of typeTests) {
  const result = isGitHubUrlType(test.url, test.types);
  const passed = result === test.expected;
  const status = passed ? '✅' : '❌';

  console.log(`${status} URL: ${test.url}`);
  console.log(`  Checking type(s): ${Array.isArray(test.types) ? test.types.join(', ') : test.types}`);
  console.log(`  Expected: ${test.expected}, Got: ${result}`);
  console.log('');
}

console.log('\n===========================================');
console.log('Testing with solve and hive use cases:');
console.log('---------------------------------\n');

// Test specific use cases for solve.mjs
const solveUrls = [
  'https://github.com/owner/repo/issues/123',
  'http://github.com/owner/repo/issues/123',
  'github.com/owner/repo/issues/123',
  'owner/repo/issues/123',
  'https://github.com/owner/repo/pull/456',
  'owner/repo/pull/456'
];

console.log('Solve.mjs URLs (should accept issues and PRs):');
for (const url of solveUrls) {
  const parsed = parseGitHubUrl(url);
  const isValid = parsed.valid && (parsed.type === 'issue' || parsed.type === 'pull');
  console.log(`${isValid ? '✅' : '❌'} ${url} -> ${parsed.normalized || 'invalid'}`);
}

console.log('');

// Test specific use cases for hive.mjs
const hiveUrls = [
  'https://github.com/konard',
  'http://github.com/konard',
  'github.com/konard',
  'konard',
  'https://github.com/konard/repo',
  'konard/repo'
];

console.log('Hive.mjs URLs (should accept users and repos):');
for (const url of hiveUrls) {
  const parsed = parseGitHubUrl(url);
  const isValid = parsed.valid && (parsed.type === 'user' || parsed.type === 'repo');
  console.log(`${isValid ? '✅' : '❌'} ${url} -> ${parsed.normalized || 'invalid'}`);
}

console.log('\n===========================================');
console.log('All tests completed!');
console.log('===========================================');
