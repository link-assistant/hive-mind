#!/usr/bin/env node

/**
 * Unit tests for Telegram bot URL validation
 * Tests the validateGitHubUrl function for both /solve and /hive commands
 */

// Import the parseGitHubUrl function
const { parseGitHubUrl } = await import('../src/github.lib.mjs');

/**
 * Validate GitHub URL for Telegram bot commands
 *
 * @param {string[]} args - Command arguments (first arg should be URL)
 * @param {Object} options - Validation options
 * @param {string[]} options.allowedTypes - Allowed URL types (e.g., ['issue', 'pull'] or ['repository', 'organization', 'user'])
 * @param {string} options.commandName - Command name for error messages (e.g., 'solve' or 'hive')
 * @param {string} options.exampleUrl - Example URL for error messages
 * @returns {{ valid: boolean, error?: string }}
 */
function validateGitHubUrl(args, options = {}) {
  // Default options for /solve command (backward compatibility)
  const { allowedTypes = ['issue', 'pull'], commandName = 'solve', exampleUrl = 'https://github.com/owner/repo/issues/123' } = options;

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

  // Parse the URL to validate structure
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) {
    return {
      valid: false,
      error: parsed.error || 'Invalid GitHub URL',
    };
  }

  // Check if the URL type is allowed for this command
  if (!allowedTypes.includes(parsed.type)) {
    const allowedTypesStr = allowedTypes.map(t => (t === 'pull' ? 'pull request' : t)).join(', ');
    return {
      valid: false,
      error: `URL must be a GitHub ${allowedTypesStr} (not ${parsed.type})`,
    };
  }

  return { valid: true };
}

console.log('===========================================');
console.log('Unit Tests: Telegram URL Validation');
console.log('===========================================\n');

// Test cases for /solve command (issue/PR only)
const solveValidTests = [
  {
    desc: 'Valid issue URL',
    args: ['https://github.com/link-assistant/hive-mind/issues/630'],
    options: undefined, // Use defaults
    shouldPass: true,
  },
  {
    desc: 'Valid PR URL',
    args: ['https://github.com/owner/repo/pull/123'],
    options: undefined,
    shouldPass: true,
  },
  {
    desc: 'Valid issue URL with options',
    args: ['https://github.com/owner/repo/issues/456', '--auto-continue'],
    options: undefined,
    shouldPass: true,
  },
  {
    desc: 'Valid PR URL with query params',
    args: ['https://github.com/owner/repo/pull/789?foo=bar'],
    options: undefined,
    shouldPass: true,
  },
];

const solveInvalidTests = [
  {
    desc: 'Repository URL only (no issue/PR)',
    args: ['https://github.com/link-assistant/master-plan'],
    options: undefined,
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue, pull request (not repo)',
  },
  {
    desc: 'Repository URL with trailing slash',
    args: ['https://github.com/owner/repo/'],
    options: undefined,
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue, pull request (not repo)',
  },
  {
    desc: 'User profile URL',
    args: ['https://github.com/owner'],
    options: undefined,
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue, pull request (not user)',
  },
  {
    desc: 'Issues list URL (no specific issue)',
    args: ['https://github.com/owner/repo/issues'],
    options: undefined,
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue, pull request (not issues_list)',
  },
  {
    desc: 'Pull requests list URL (no specific PR)',
    args: ['https://github.com/owner/repo/pulls'],
    options: undefined,
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue, pull request (not pulls_list)',
  },
  {
    desc: 'Missing URL',
    args: [],
    options: undefined,
    shouldPass: false,
    expectedError: 'Missing GitHub URL. Usage: /solve <github-url> [options]',
  },
  {
    desc: 'Non-GitHub URL',
    args: ['https://example.com/issues/123'],
    options: undefined,
    shouldPass: false,
    expectedError: 'First argument must be a GitHub URL',
  },
  {
    desc: 'GitHub Actions URL',
    args: ['https://github.com/owner/repo/actions/runs/123'],
    options: undefined,
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue, pull request (not action_run)',
  },
  {
    desc: 'GitHub file URL',
    args: ['https://github.com/owner/repo/blob/main/README.md'],
    options: undefined,
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue, pull request (not file)',
  },
];

// Test cases for /hive command (repo/organization/user)
const hiveValidTests = [
  {
    desc: 'Valid repository URL',
    args: ['https://github.com/link-assistant/hive-mind'],
    options: {
      allowedTypes: ['repo', 'organization', 'user'],
      commandName: 'hive',
      exampleUrl: 'https://github.com/owner/repo',
    },
    shouldPass: true,
  },
  {
    desc: 'Valid organization URL',
    args: ['https://github.com/link-assistant'],
    options: {
      allowedTypes: ['repo', 'organization', 'user'],
      commandName: 'hive',
      exampleUrl: 'https://github.com/owner/repo',
    },
    shouldPass: true,
  },
  {
    desc: 'Valid repository URL with trailing slash',
    args: ['https://github.com/owner/repo/'],
    options: {
      allowedTypes: ['repo', 'organization', 'user'],
      commandName: 'hive',
      exampleUrl: 'https://github.com/owner/repo',
    },
    shouldPass: true,
  },
];

const hiveInvalidTests = [
  {
    desc: 'Issue URL (not allowed for hive)',
    args: ['https://github.com/owner/repo/issues/123'],
    options: {
      allowedTypes: ['repo', 'organization', 'user'],
      commandName: 'hive',
      exampleUrl: 'https://github.com/owner/repo',
    },
    shouldPass: false,
    expectedError: 'URL must be a GitHub repo, organization, user (not issue)',
  },
  {
    desc: 'PR URL (not allowed for hive)',
    args: ['https://github.com/owner/repo/pull/456'],
    options: {
      allowedTypes: ['repo', 'organization', 'user'],
      commandName: 'hive',
      exampleUrl: 'https://github.com/owner/repo',
    },
    shouldPass: false,
    expectedError: 'URL must be a GitHub repo, organization, user (not pull)',
  },
  {
    desc: 'Missing URL',
    args: [],
    options: {
      allowedTypes: ['repo', 'organization', 'user'],
      commandName: 'hive',
      exampleUrl: 'https://github.com/owner/repo',
    },
    shouldPass: false,
    expectedError: 'Missing GitHub URL. Usage: /hive <github-url> [options]',
  },
];

let passed = 0;
let failed = 0;

function runTest(testCase) {
  const result = validateGitHubUrl(testCase.args, testCase.options);
  const isValid = result.valid === testCase.shouldPass;
  const errorMatches = !testCase.expectedError || result.error === testCase.expectedError;
  const success = isValid && errorMatches;

  if (success) {
    passed++;
    console.log(`✅ PASS: ${testCase.desc}`);
  } else {
    failed++;
    console.log(`❌ FAIL: ${testCase.desc}`);
    console.log(`   Input:           ${JSON.stringify(testCase.args)}`);
    if (!isValid) {
      console.log(`   Expected valid:  ${testCase.shouldPass}`);
      console.log(`   Got valid:       ${result.valid}`);
    }
    if (!errorMatches) {
      console.log(`   Expected Error:  ${testCase.expectedError}`);
      console.log(`   Got Error:       ${result.error}`);
    }
  }
}

console.log('Test Suite 1: /solve command - Valid URLs (Should Pass)\n');
for (const testCase of solveValidTests) {
  runTest(testCase);
}

console.log('\nTest Suite 2: /solve command - Invalid URLs (Should Fail)\n');
for (const testCase of solveInvalidTests) {
  runTest(testCase);
}

console.log('\nTest Suite 3: /hive command - Valid URLs (Should Pass)\n');
for (const testCase of hiveValidTests) {
  runTest(testCase);
}

console.log('\nTest Suite 4: /hive command - Invalid URLs (Should Fail)\n');
for (const testCase of hiveInvalidTests) {
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
