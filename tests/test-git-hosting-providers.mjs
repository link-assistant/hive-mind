#!/usr/bin/env node
/**
 * Tests for Git Hosting Provider abstraction layer
 *
 * Tests:
 * - Provider detection from URLs
 * - URL parsing for each provider
 * - Provider interface implementation
 */

// Check if use is already defined
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Import the git hosting module
import {
  detectProvider,
  getProviderForUrl,
  getProvider,
  isSupportedUrl,
  getSupportedProviders,
  parseUrl,
  normalizeUrl,
  GitHubProvider,
  GitLabProvider,
  BitBucketProvider
} from '../src/git-hosting/index.mjs';

// Test utilities
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ✅ ${message}`);
  } else {
    testsFailed++;
    console.log(`  ❌ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  testsRun++;
  if (actual === expected) {
    testsPassed++;
    console.log(`  ✅ ${message}`);
  } else {
    testsFailed++;
    console.log(`  ❌ ${message}`);
    console.log(`     Expected: ${expected}`);
    console.log(`     Actual:   ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  testsRun++;
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  if (actualJson === expectedJson) {
    testsPassed++;
    console.log(`  ✅ ${message}`);
  } else {
    testsFailed++;
    console.log(`  ❌ ${message}`);
    console.log(`     Expected: ${expectedJson}`);
    console.log(`     Actual:   ${actualJson}`);
  }
}

// ============================================================================
// Tests
// ============================================================================

console.log('\n🧪 Testing Git Hosting Provider Abstraction\n');

// Test 1: getSupportedProviders
console.log('📋 Testing getSupportedProviders()');
{
  const providers = getSupportedProviders();
  assert(providers.includes('github'), 'Should include github');
  assert(providers.includes('gitlab'), 'Should include gitlab');
  assert(providers.includes('bitbucket'), 'Should include bitbucket');
  assertEqual(providers.length, 3, 'Should have 3 providers');
}

// Test 2: detectProvider - GitHub
console.log('\n📋 Testing detectProvider() - GitHub');
{
  const tests = [
    { url: 'https://github.com/owner/repo', expected: 'github' },
    { url: 'http://github.com/owner/repo', expected: 'github' },
    { url: 'github.com/owner/repo', expected: 'github' },
    { url: 'https://www.github.com/owner/repo', expected: 'github' },
    { url: 'https://github.com/owner/repo/issues/123', expected: 'github' },
    { url: 'https://github.com/owner/repo/pull/456', expected: 'github' },
    { url: 'owner/repo', expected: 'github' }, // Shorthand defaults to GitHub
  ];

  for (const test of tests) {
    const result = detectProvider(test.url);
    assertEqual(result?.name, test.expected, `detectProvider('${test.url}') should be '${test.expected}'`);
  }
}

// Test 3: detectProvider - GitLab
console.log('\n📋 Testing detectProvider() - GitLab');
{
  const tests = [
    { url: 'https://gitlab.com/owner/repo', expected: 'gitlab' },
    { url: 'gitlab.com/owner/repo', expected: 'gitlab' },
    { url: 'https://gitlab.com/owner/repo/-/issues/123', expected: 'gitlab' },
  ];

  for (const test of tests) {
    const result = detectProvider(test.url);
    assertEqual(result?.name, test.expected, `detectProvider('${test.url}') should be '${test.expected}'`);
  }
}

// Test 4: detectProvider - BitBucket
console.log('\n📋 Testing detectProvider() - BitBucket');
{
  const tests = [
    { url: 'https://bitbucket.org/owner/repo', expected: 'bitbucket' },
    { url: 'bitbucket.org/owner/repo', expected: 'bitbucket' },
    { url: 'https://bitbucket.org/owner/repo/issues/123', expected: 'bitbucket' },
  ];

  for (const test of tests) {
    const result = detectProvider(test.url);
    assertEqual(result?.name, test.expected, `detectProvider('${test.url}') should be '${test.expected}'`);
  }
}

// Test 5: isSupportedUrl
console.log('\n📋 Testing isSupportedUrl()');
{
  assert(isSupportedUrl('https://github.com/owner/repo'), 'GitHub URL should be supported');
  assert(isSupportedUrl('https://gitlab.com/owner/repo'), 'GitLab URL should be supported');
  assert(isSupportedUrl('https://bitbucket.org/owner/repo'), 'BitBucket URL should be supported');
  assert(!isSupportedUrl('https://example.com/owner/repo'), 'Unknown host should not be supported');
  assert(!isSupportedUrl(''), 'Empty URL should not be supported');
  assert(!isSupportedUrl(null), 'Null should not be supported');
}

// Test 6: GitHub URL Parsing
console.log('\n📋 Testing GitHub URL Parsing');
{
  const github = getProvider('github');

  // Issue URL
  const issueUrl = github.parseUrl('https://github.com/owner/repo/issues/123');
  assertEqual(issueUrl.valid, true, 'Issue URL should be valid');
  assertEqual(issueUrl.type, 'issue', 'Type should be issue');
  assertEqual(issueUrl.owner, 'owner', 'Owner should be owner');
  assertEqual(issueUrl.repo, 'repo', 'Repo should be repo');
  assertEqual(issueUrl.number, 123, 'Number should be 123');

  // PR URL
  const prUrl = github.parseUrl('https://github.com/owner/repo/pull/456');
  assertEqual(prUrl.valid, true, 'PR URL should be valid');
  assertEqual(prUrl.type, 'pull', 'Type should be pull');
  assertEqual(prUrl.number, 456, 'Number should be 456');

  // Repo URL
  const repoUrl = github.parseUrl('https://github.com/owner/repo');
  assertEqual(repoUrl.valid, true, 'Repo URL should be valid');
  assertEqual(repoUrl.type, 'repo', 'Type should be repo');

  // User URL
  const userUrl = github.parseUrl('https://github.com/owner');
  assertEqual(userUrl.valid, true, 'User URL should be valid');
  assertEqual(userUrl.type, 'user', 'Type should be user');

  // Shorthand
  const shorthand = github.parseUrl('owner/repo');
  assertEqual(shorthand.valid, true, 'Shorthand should be valid');
  assertEqual(shorthand.type, 'repo', 'Shorthand type should be repo');
  assertEqual(shorthand.normalized, 'https://github.com/owner/repo', 'Shorthand should normalize');

  // Invalid URL
  const invalid = github.parseUrl('https://gitlab.com/owner/repo');
  assertEqual(invalid.valid, false, 'GitLab URL should be invalid for GitHub provider');
}

// Test 7: GitLab URL Parsing
console.log('\n📋 Testing GitLab URL Parsing');
{
  const gitlab = getProvider('gitlab');

  // Issue URL
  const issueUrl = gitlab.parseUrl('https://gitlab.com/owner/repo/-/issues/123');
  assertEqual(issueUrl.valid, true, 'Issue URL should be valid');
  assertEqual(issueUrl.type, 'issue', 'Type should be issue');
  assertEqual(issueUrl.number, 123, 'Number should be 123');

  // MR URL
  const mrUrl = gitlab.parseUrl('https://gitlab.com/owner/repo/-/merge_requests/456');
  assertEqual(mrUrl.valid, true, 'MR URL should be valid');
  assertEqual(mrUrl.type, 'pull', 'Type should be pull (mapped from merge_requests)');
  assertEqual(mrUrl.number, 456, 'Number should be 456');

  // Repo URL
  const repoUrl = gitlab.parseUrl('https://gitlab.com/owner/repo');
  assertEqual(repoUrl.valid, true, 'Repo URL should be valid');
  assertEqual(repoUrl.type, 'repo', 'Type should be repo');
}

// Test 8: BitBucket URL Parsing
console.log('\n📋 Testing BitBucket URL Parsing');
{
  const bitbucket = getProvider('bitbucket');

  // Issue URL
  const issueUrl = bitbucket.parseUrl('https://bitbucket.org/owner/repo/issues/123');
  assertEqual(issueUrl.valid, true, 'Issue URL should be valid');
  assertEqual(issueUrl.type, 'issue', 'Type should be issue');
  assertEqual(issueUrl.number, 123, 'Number should be 123');

  // PR URL
  const prUrl = bitbucket.parseUrl('https://bitbucket.org/owner/repo/pull-requests/456');
  assertEqual(prUrl.valid, true, 'PR URL should be valid');
  assertEqual(prUrl.type, 'pull', 'Type should be pull');
  assertEqual(prUrl.number, 456, 'Number should be 456');

  // Repo URL
  const repoUrl = bitbucket.parseUrl('https://bitbucket.org/owner/repo');
  assertEqual(repoUrl.valid, true, 'Repo URL should be valid');
  assertEqual(repoUrl.type, 'repo', 'Type should be repo');
}

// Test 9: URL Building
console.log('\n📋 Testing URL Building');
{
  const github = getProvider('github');
  const gitlab = getProvider('gitlab');
  const bitbucket = getProvider('bitbucket');

  assertEqual(
    github.buildUrl({ owner: 'owner', repo: 'repo', type: 'issue', number: 123 }),
    'https://github.com/owner/repo/issues/123',
    'GitHub issue URL should be built correctly'
  );

  assertEqual(
    gitlab.buildUrl({ owner: 'owner', repo: 'repo', type: 'issue', number: 123 }),
    'https://gitlab.com/owner/repo/-/issues/123',
    'GitLab issue URL should be built correctly'
  );

  assertEqual(
    bitbucket.buildUrl({ owner: 'owner', repo: 'repo', type: 'pull', number: 456 }),
    'https://bitbucket.org/owner/repo/pull-requests/456',
    'BitBucket PR URL should be built correctly'
  );
}

// Test 10: Provider Info
console.log('\n📋 Testing Provider Info');
{
  const github = getProvider('github');
  const info = github.getProviderInfo();

  assertEqual(info.name, 'github', 'Name should be github');
  assertEqual(info.displayName, 'GitHub', 'Display name should be GitHub');
  assertEqual(info.hostname, 'github.com', 'Hostname should be github.com');
  assertEqual(info.cliTool, 'gh', 'CLI tool should be gh');
  assert(info.hostnames.includes('github.com'), 'Hostnames should include github.com');
}

// Test 11: getProviderForUrl convenience function
console.log('\n📋 Testing getProviderForUrl()');
{
  const githubProvider = getProviderForUrl('https://github.com/owner/repo');
  assert(githubProvider instanceof GitHubProvider, 'Should return GitHubProvider instance');

  const gitlabProvider = getProviderForUrl('https://gitlab.com/owner/repo');
  assert(gitlabProvider instanceof GitLabProvider, 'Should return GitLabProvider instance');

  const bitbucketProvider = getProviderForUrl('https://bitbucket.org/owner/repo');
  assert(bitbucketProvider instanceof BitBucketProvider, 'Should return BitBucketProvider instance');

  const unknown = getProviderForUrl('https://example.com/owner/repo');
  assertEqual(unknown, null, 'Unknown URL should return null');
}

// Test 12: normalizeUrl convenience function
console.log('\n📋 Testing normalizeUrl()');
{
  assertEqual(
    normalizeUrl('github.com/owner/repo'),
    'https://github.com/owner/repo',
    'Should normalize GitHub URL'
  );

  assertEqual(
    normalizeUrl('http://github.com/owner/repo'),
    'https://github.com/owner/repo',
    'Should convert http to https'
  );

  assertEqual(
    normalizeUrl('owner/repo'),
    'https://github.com/owner/repo',
    'Should expand shorthand to GitHub URL'
  );
}

// Test 13: Rate limit error detection
console.log('\n📋 Testing Rate Limit Error Detection');
{
  const github = getProvider('github');

  assert(github.isRateLimitError({ message: 'API rate limit exceeded' }), 'Should detect rate limit error');
  assert(github.isRateLimitError({ message: 'secondary rate limit' }), 'Should detect secondary rate limit');
  assert(github.isRateLimitError({ message: 'Too many requests' }), 'Should detect too many requests');
  assert(!github.isRateLimitError({ message: 'Not found' }), 'Should not detect non-rate-limit error');
}

// ============================================================================
// Summary
// ============================================================================

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 Test Results: ${testsPassed}/${testsRun} passed`);

if (testsFailed > 0) {
  console.log(`❌ ${testsFailed} tests failed`);
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
  process.exit(0);
}
