#!/usr/bin/env node

// Experiment to reproduce and verify the hash tag URL parsing issue
// Issue: https://github.com/link-assistant/hive-mind/issues/991

// The problematic URL from the issue
const testUrl = 'https://github.com/tool2agent/tool2agent/pull/9#issuecomment-3691329187';

console.log('=== Testing parseUrlComponents (CURRENT - BUG) ===');
// Current buggy implementation
const parseUrlComponentsBuggy = issueUrl => {
  const urlParts = issueUrl.split('/');
  return {
    owner: urlParts[3],
    repo: urlParts[4],
    urlNumber: urlParts[6], // Could be issue or PR number
  };
};

const buggyResult = parseUrlComponentsBuggy(testUrl);
console.log('Input URL:', testUrl);
console.log('Buggy result:', buggyResult);
console.log('urlNumber is:', buggyResult.urlNumber);
console.log('Expected urlNumber: "9"');
console.log('Bug: urlNumber contains hash fragment!');

console.log('\n=== Testing parseUrlComponents (FIXED) ===');
// Fixed implementation
const parseUrlComponentsFixed = issueUrl => {
  // Remove hash fragment before splitting
  const urlWithoutHash = issueUrl.split('#')[0];
  const urlParts = urlWithoutHash.split('/');
  return {
    owner: urlParts[3],
    repo: urlParts[4],
    urlNumber: urlParts[6], // Could be issue or PR number
  };
};

const fixedResult = parseUrlComponentsFixed(testUrl);
console.log('Input URL:', testUrl);
console.log('Fixed result:', fixedResult);
console.log('urlNumber is:', fixedResult.urlNumber);
console.log('urlNumber is correct:', fixedResult.urlNumber === '9');

console.log('\n=== Alternative fix using URL object ===');
// Alternative: Use URL object like parseGitHubUrl does
const parseUrlComponentsWithUrlObject = issueUrl => {
  const urlObj = new URL(issueUrl);
  const pathParts = urlObj.pathname.split('/').filter(p => p);
  return {
    owner: pathParts[0],
    repo: pathParts[1],
    urlNumber: pathParts[3], // Could be issue or PR number
  };
};

const urlObjectResult = parseUrlComponentsWithUrlObject(testUrl);
console.log('Input URL:', testUrl);
console.log('URL object result:', urlObjectResult);
console.log('urlNumber is:', urlObjectResult.urlNumber);
console.log('urlNumber is correct:', urlObjectResult.urlNumber === '9');

console.log('\n=== Edge cases ===');
const edgeCases = ['https://github.com/owner/repo/issues/123', 'https://github.com/owner/repo/issues/123#issuecomment-456', 'https://github.com/owner/repo/pull/789', 'https://github.com/owner/repo/pull/789#discussion_r123', 'https://github.com/owner/repo/pull/789#pullrequestreview-123'];

for (const url of edgeCases) {
  const buggy = parseUrlComponentsBuggy(url);
  const fixed = parseUrlComponentsFixed(url);
  const withUrlObj = parseUrlComponentsWithUrlObject(url);

  console.log(`\nURL: ${url}`);
  console.log(`  Buggy: urlNumber=${buggy.urlNumber}`);
  console.log(`  Fixed: urlNumber=${fixed.urlNumber}`);
  console.log(`  URL obj: urlNumber=${withUrlObj.urlNumber}`);
}

console.log('\n=== Conclusion ===');
console.log('The fix is simple: strip hash fragment before parsing.');
console.log('Option 1: url.split("#")[0] before split("/")');
console.log('Option 2: Use URL object which handles fragments correctly');
