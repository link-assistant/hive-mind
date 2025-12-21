#!/usr/bin/env node

// Test solve URL normalization logic
const testUrls = [
  'https://github.com/konard/test/issues/1',
  'http://github.com/konard/test/issues/1',
  'github.com/konard/test/issues/1',
  'konard/test/issues/1',
  'https://github.com/konard/test/pull/1',
  'http://github.com/konard/test/pull/1',
  'github.com/konard/test/pull/1',
  'konard/test/pull/1'
];

function validateGitHubUrl(issueUrl) {
  if (!issueUrl) {
    return { isValid: false, isIssueUrl: null, isPrUrl: null };
  }

  // Normalize the URL first - handle http://, missing protocols, etc.
  let normalizedUrl = issueUrl;

  // Remove trailing slashes
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // If no protocol, assume https
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    // Handle cases like "github.com/owner/repo/issues/123"
    if (normalizedUrl.startsWith('github.com/')) {
      normalizedUrl = 'https://' + normalizedUrl;
    } else if (!normalizedUrl.includes('github.com')) {
      // Assume it's just owner/repo/issues/123 without the github.com part
      normalizedUrl = 'https://github.com/' + normalizedUrl;
    }
  }

  // Convert http to https
  if (normalizedUrl.startsWith('http://')) {
    normalizedUrl = normalizedUrl.replace(/^http:\/\//, 'https://');
  }

  // Do the regex matching ONCE - these results will be used everywhere
  const isIssueUrl = normalizedUrl.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/);
  const isPrUrl = normalizedUrl.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/);

  // Fail fast if URL is invalid
  if (!isIssueUrl && !isPrUrl) {
    return { isValid: false, isIssueUrl: null, isPrUrl: null, normalizedUrl };
  }

  return { isValid: true, isIssueUrl, isPrUrl, normalizedUrl };
}

console.log('Testing solve.mjs URL normalization:');
console.log('====================================');

for (const url of testUrls) {
  const result = validateGitHubUrl(url);
  console.log(`Input:  ${url}`);
  console.log(`Output: ${result.normalizedUrl}`);
  console.log(`Valid:  ${result.isValid ? '✅' : '❌'}`);
  console.log(`Type:   ${result.isIssueUrl ? 'Issue' : result.isPrUrl ? 'PR' : 'Unknown'}`);
  console.log('');
}
