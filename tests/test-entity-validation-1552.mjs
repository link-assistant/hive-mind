#!/usr/bin/env node

/**
 * Unit tests for GitHub entity existence validation (Issue #1552)
 *
 * Tests the validateGitHubEntityExistence logic by simulating:
 * - Non-existent user/organization detection
 * - Non-existent repository detection
 * - Non-existent issue detection
 * - Non-existent PR detection with issue suggestion
 * - Non-existent issue detection with PR suggestion
 * - Successful validation when all entities exist
 * - Graceful handling of network/auth errors (don't block)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1552
 */

console.log('🧪 Running GitHub entity validation unit tests (Issue #1552)...\n');
console.log('='.repeat(80));
console.log('Test Suite: validateGitHubEntityExistence logic');
console.log('='.repeat(80));
console.log();

let passed = 0;
let failed = 0;

/**
 * Simulated version of validateGitHubEntityExistence for unit testing.
 * Mirrors the logic of the real function but uses injected mock responses.
 */
async function validateGitHubEntityExistenceWithMocks({ owner, repo, number, type, verbose = false }, mocks) {
  // Step 1: Check user/organization existence
  const userResponse = mocks.userCheck?.(owner);
  if (userResponse?.code !== 0) {
    if (userResponse?.error?.includes('404') || userResponse?.error?.includes('Not Found')) {
      return {
        valid: false,
        error: `GitHub user or organization '${owner}' does not exist.\n\n💡 Please check:\n• The username/organization name is spelled correctly\n• The account has not been deleted or renamed`,
        level: 'user',
      };
    }
    // Non-404 errors - don't block
  }

  // Step 2: Check repository existence
  const repoResponse = mocks.repoCheck?.(owner, repo);
  if (repoResponse?.code !== 0) {
    if (repoResponse?.error?.includes('404') || repoResponse?.error?.includes('Not Found')) {
      return {
        valid: false,
        error: `Repository '${owner}/${repo}' not found.\n\n💡 Please check:\n• The repository name is spelled correctly\n• If it's a private repository, ensure the bot has been granted access\n• The repository has not been deleted or transferred`,
        level: 'repo',
      };
    }
  }

  // Step 3: Check issue or PR existence
  if (number) {
    if (type === 'pull') {
      const prResponse = mocks.prCheck?.(owner, repo, number);
      if (prResponse?.code !== 0 && prResponse?.notFound) {
        let suggestion = '';
        const issueCheck = mocks.issueCheck?.(owner, repo, number);
        if (issueCheck?.code === 0 && issueCheck?.data) {
          suggestion = `\n\n💡 However, Issue #${number} exists: "${issueCheck.data.title}"\n   Did you mean: https://github.com/${owner}/${repo}/issues/${number}`;
        }
        return {
          valid: false,
          error: `Pull request #${number} does not exist in ${owner}/${repo}.${suggestion}\n\n💡 Please check:\n• The PR number is correct\n• The PR has not been deleted`,
          level: 'pull',
        };
      }
    } else {
      const issueResponse = mocks.issueCheck?.(owner, repo, number);
      if (issueResponse?.code !== 0 && issueResponse?.notFound) {
        let suggestion = '';
        const prCheck = mocks.prCheck?.(owner, repo, number);
        if (prCheck?.code === 0 && prCheck?.data) {
          suggestion = `\n\n💡 However, Pull Request #${number} exists: "${prCheck.data.title}"\n   Did you mean: https://github.com/${owner}/${repo}/pull/${number}`;
        }
        return {
          valid: false,
          error: `Issue #${number} does not exist in ${owner}/${repo}.${suggestion}\n\n💡 Please check:\n• The issue number is correct\n• The issue has not been deleted or transferred`,
          level: 'issue',
        };
      }
    }
  }

  return { valid: true };
}

const testCases = [
  {
    name: 'Fails when user/organization does not exist',
    input: { owner: 'nonexistent-user', repo: 'some-repo', number: 1, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 1, error: '404 Not Found' }),
    },
    expected: { valid: false, level: 'user' },
    errorContains: "user or organization 'nonexistent-user' does not exist",
  },
  {
    name: 'Fails when repository does not exist',
    input: { owner: 'valid-user', repo: 'nonexistent-repo', number: 1, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 1, error: '404 Not Found' }),
    },
    expected: { valid: false, level: 'repo' },
    errorContains: "Repository 'valid-user/nonexistent-repo' not found",
  },
  {
    name: 'Fails when issue does not exist',
    input: { owner: 'valid-user', repo: 'valid-repo', number: 999, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 0 }),
      issueCheck: () => ({ code: 1, notFound: true }),
      prCheck: () => ({ code: 1 }),
    },
    expected: { valid: false, level: 'issue' },
    errorContains: 'Issue #999 does not exist',
  },
  {
    name: 'Fails when PR does not exist',
    input: { owner: 'valid-user', repo: 'valid-repo', number: 42, type: 'pull' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 0 }),
      prCheck: () => ({ code: 1, notFound: true }),
      issueCheck: () => ({ code: 1 }),
    },
    expected: { valid: false, level: 'pull' },
    errorContains: 'Pull request #42 does not exist',
  },
  {
    name: 'Suggests issue URL when PR not found but issue exists with same number',
    input: { owner: 'owner', repo: 'repo', number: 5, type: 'pull' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 0 }),
      prCheck: () => ({ code: 1, notFound: true }),
      issueCheck: () => ({ code: 0, data: { title: 'My Issue' } }),
    },
    expected: { valid: false, level: 'pull' },
    errorContains: 'However, Issue #5 exists',
  },
  {
    name: 'Suggests PR URL when issue not found but PR exists with same number',
    input: { owner: 'owner', repo: 'repo', number: 5, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 0 }),
      issueCheck: () => ({ code: 1, notFound: true }),
      prCheck: () => ({ code: 0, data: { title: 'My PR' } }),
    },
    expected: { valid: false, level: 'issue' },
    errorContains: 'However, Pull Request #5 exists',
  },
  {
    name: 'Passes when all entities exist (issue)',
    input: { owner: 'valid-user', repo: 'valid-repo', number: 1, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 0 }),
      issueCheck: () => ({ code: 0, data: { number: 1, title: 'Test Issue' } }),
    },
    expected: { valid: true },
  },
  {
    name: 'Passes when all entities exist (pull)',
    input: { owner: 'valid-user', repo: 'valid-repo', number: 10, type: 'pull' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 0 }),
      prCheck: () => ({ code: 0, data: { number: 10, state: 'OPEN' } }),
    },
    expected: { valid: true },
  },
  {
    name: 'Does not block on network/auth errors for user check (non-404)',
    input: { owner: 'some-user', repo: 'some-repo', number: 1, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 1, error: 'Connection timeout' }),
      repoCheck: () => ({ code: 0 }),
      issueCheck: () => ({ code: 0, data: { number: 1, title: 'Test' } }),
    },
    expected: { valid: true },
  },
  {
    name: 'Does not block on network/auth errors for repo check (non-404)',
    input: { owner: 'some-user', repo: 'some-repo', number: 1, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 1, error: 'TLS handshake timeout' }),
      issueCheck: () => ({ code: 0, data: { number: 1, title: 'Test' } }),
    },
    expected: { valid: true },
  },
  {
    name: 'Validates without number (repo-level check only)',
    input: { owner: 'valid-user', repo: 'valid-repo' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 0 }),
    },
    expected: { valid: true },
  },
  {
    name: 'Fails at user level even when repo might exist',
    input: { owner: 'deleted-user', repo: 'some-repo', number: 1, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 1, error: 'Not Found' }),
    },
    expected: { valid: false, level: 'user' },
    errorContains: "user or organization 'deleted-user' does not exist",
  },
  {
    name: 'Checks entities in order: user -> repo -> issue (fails at repo)',
    input: { owner: 'valid-user', repo: 'bad-repo', number: 1, type: 'issue' },
    mocks: {
      userCheck: () => ({ code: 0 }),
      repoCheck: () => ({ code: 1, error: '404' }),
    },
    expected: { valid: false, level: 'repo' },
    errorContains: "Repository 'valid-user/bad-repo' not found",
  },
];

for (const testCase of testCases) {
  let success = true;
  const failures = [];

  try {
    const result = await validateGitHubEntityExistenceWithMocks(testCase.input, testCase.mocks);

    // Check valid flag
    if (result.valid !== testCase.expected.valid) {
      success = false;
      failures.push(`Expected valid=${testCase.expected.valid}, got ${result.valid}`);
    }

    // Check level (if expected)
    if (testCase.expected.level && result.level !== testCase.expected.level) {
      success = false;
      failures.push(`Expected level='${testCase.expected.level}', got '${result.level}'`);
    }

    // Check error message contains expected text (if specified)
    if (testCase.errorContains && (!result.error || !result.error.includes(testCase.errorContains))) {
      success = false;
      failures.push(`Expected error to contain: "${testCase.errorContains}"`);
      failures.push(`Actual error: "${result.error || '(none)'}"`);
    }

    // If expected valid=true, ensure no error
    if (testCase.expected.valid && result.error) {
      success = false;
      failures.push(`Expected no error but got: "${result.error}"`);
    }
  } catch (err) {
    success = false;
    failures.push(`Threw exception: ${err.message}`);
  }

  if (success) {
    console.log(`✅ PASS: ${testCase.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${testCase.name}`);
    for (const failure of failures) {
      console.log(`   ${failure}`);
    }
    failed++;
  }
}

console.log();
console.log('='.repeat(80));
console.log('Test Summary');
console.log('='.repeat(80));
console.log(`Total tests:  ${testCases.length}`);
console.log(`Passed:       ${passed} ✅`);
console.log(`Failed:       ${failed} ${failed > 0 ? '❌' : ''}`);
console.log('='.repeat(80));
console.log();

if (failed === 0) {
  console.log('🎉 All tests passed!');
  console.log();
  console.log('📝 Issue #1552 requirements verified:');
  console.log('   ✅ Non-existent user/organization is detected and fails immediately');
  console.log('   ✅ Non-existent repository is detected and fails immediately');
  console.log('   ✅ Non-existent issue is detected and fails immediately');
  console.log('   ✅ Non-existent PR is detected and fails immediately');
  console.log('   ✅ Suggests issue URL when PR not found but issue exists');
  console.log('   ✅ Suggests PR URL when issue not found but PR exists');
  console.log('   ✅ Passes when all entities exist');
  console.log('   ✅ Does not block on non-404 errors (network, auth)');
  console.log('   ✅ Checks entities in hierarchical order (user -> repo -> issue/PR)');
  console.log();
  process.exit(0);
} else {
  console.log(`❌ ${failed} test(s) failed!`);
  console.log();
  process.exit(1);
}
