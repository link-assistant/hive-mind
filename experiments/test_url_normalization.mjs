#!/usr/bin/env node

// Test URL normalization logic
const testUrls = ['https://github.com/konard', 'http://github.com/konard', 'github.com/konard', 'konard', 'https://github.com/konard/test-repo', 'http://github.com/konard/test-repo', 'github.com/konard/test-repo', 'konard/test-repo'];

function normalizeGitHubUrl(githubUrl) {
  if (!githubUrl) return null;

  // Remove trailing slashes
  githubUrl = githubUrl.replace(/\/+$/, '');

  // If no protocol, assume https
  if (!githubUrl.startsWith('http://') && !githubUrl.startsWith('https://')) {
    // Handle cases like "github.com/owner" or just "owner/repo"
    if (githubUrl.startsWith('github.com/')) {
      githubUrl = 'https://' + githubUrl;
    } else if (!githubUrl.includes('github.com')) {
      // Assume it's just owner or owner/repo without the github.com part
      githubUrl = 'https://github.com/' + githubUrl;
    }
  }

  // Convert http to https
  if (githubUrl.startsWith('http://')) {
    githubUrl = githubUrl.replace(/^http:\/\//, 'https://');
  }

  return githubUrl;
}

console.log('Testing URL normalization:');
console.log('=========================');

for (const url of testUrls) {
  const normalized = normalizeGitHubUrl(url);
  const isValid = normalized && normalized.match(/^https:\/\/github\.com\/([^/]+)(\/([^/]+))?$/);
  console.log(`Input:  ${url}`);
  console.log(`Output: ${normalized}`);
  console.log(`Valid:  ${isValid ? '✅' : '❌'}`);
  console.log('');
}
