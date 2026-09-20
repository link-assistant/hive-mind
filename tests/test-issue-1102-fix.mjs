#!/usr/bin/env node

/**
 * Tests for Issue #1102 fix: Allow issues_list URLs for /hive command
 *
 * This test verifies that:
 * 1. /hive command accepts issues_list URLs (e.g., https://github.com/owner/repo/issues)
 * 2. /hive command accepts pulls_list URLs (e.g., https://github.com/owner/repo/pulls)
 * 3. Non-printable characters are cleaned from URLs
 * 4. Error messages escape special characters properly
 */

// Import the dependencies
const { parseGitHubUrl } = await import('../src/github.lib.mjs');
const { cleanNonPrintableChars, escapeMarkdown } = await import('../src/telegram-markdown.lib.mjs');

/**
 * Updated validateGitHubUrl function matching the fix in telegram-bot.mjs
 * This version:
 * 1. Cleans non-printable characters from URLs
 * 2. Escapes URLs in error messages
 * 3. Returns parsed data and normalizedUrl for callers
 */
function validateGitHubUrl(args, options = {}) {
  const { allowedTypes = ['issue', 'pull'], commandName = 'solve' } = options;

  if (args.length === 0) {
    return {
      valid: false,
      error: `Missing GitHub URL. Usage: /${commandName} <github-url> [options]`,
    };
  }

  // Issue #1102: Clean non-printable characters from the URL
  const url = cleanNonPrintableChars(args[0]);
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
    const baseUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    // Issue #1102: Escape URLs in error messages
    const escapedUrl = escapeMarkdown(url);
    const escapedBaseUrl = escapeMarkdown(baseUrl);

    let error;
    if (parsed.type === 'issues_list') {
      error = `URL points to the issues list page, but you need a specific issue\n\n💡 How to fix:\n1. Open the repository: ${escapedUrl}\n2. Click on a specific issue\n3. Copy the URL (it should end with /issues/NUMBER)\n\nExample: \`${escapedBaseUrl}/issues/1\``;
    } else if (parsed.type === 'pulls_list') {
      error = `URL points to the pull requests list page, but you need a specific pull request\n\n💡 How to fix:\n1. Open the repository: ${escapedUrl}\n2. Click on a specific pull request\n3. Copy the URL (it should end with /pull/NUMBER)\n\nExample: \`${escapedBaseUrl}/pull/1\``;
    } else if (parsed.type === 'repo') {
      error = `URL points to a repository, but you need a specific ${allowedTypesStr}\n\n💡 How to fix:\n1. Go to: ${escapedUrl}/issues\n2. Click on an issue to solve\n3. Use the full URL with the issue number\n\nExample: \`${escapedBaseUrl}/issues/1\``;
    } else {
      error = `URL must be a GitHub ${allowedTypesStr} (not ${parsed.type.replace('_', ' ')})`;
    }

    return { valid: false, error };
  }

  return { valid: true, parsed, normalizedUrl: url };
}

console.log('===========================================');
console.log('Issue #1102 Fix Tests');
console.log('===========================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      passed++;
      console.log(`✅ PASS: ${name}`);
    } else {
      failed++;
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Result: ${result}`);
    }
  } catch (error) {
    failed++;
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

console.log('Test Suite 1: /hive command accepts issues_list URLs\n');

// Hive options with new allowed types
const hiveOptions = {
  allowedTypes: ['repo', 'organization', 'user', 'issues_list', 'pulls_list'],
  commandName: 'hive',
};

test('issues_list URL should be valid for /hive', () => {
  const result = validateGitHubUrl(['https://github.com/VisageDvachevsky/StoryGraph/issues'], hiveOptions);
  return result.valid === true;
});

test('pulls_list URL should be valid for /hive', () => {
  const result = validateGitHubUrl(['https://github.com/owner/repo/pulls'], hiveOptions);
  return result.valid === true;
});

test('repo URL should still be valid for /hive', () => {
  const result = validateGitHubUrl(['https://github.com/owner/repo'], hiveOptions);
  return result.valid === true;
});

test('user URL should still be valid for /hive', () => {
  const result = validateGitHubUrl(['https://github.com/owner'], hiveOptions);
  return result.valid === true;
});

console.log('\nTest Suite 2: URL normalization for /hive\n');

test('issues_list URL returns parsed data with type issues_list', () => {
  const result = validateGitHubUrl(['https://github.com/owner/repo/issues'], hiveOptions);
  return result.valid && result.parsed && result.parsed.type === 'issues_list';
});

test('issues_list URL returns correct owner/repo', () => {
  const result = validateGitHubUrl(['https://github.com/VisageDvachevsky/StoryGraph/issues'], hiveOptions);
  return result.valid && result.parsed.owner === 'VisageDvachevsky' && result.parsed.repo === 'StoryGraph';
});

console.log('\nTest Suite 3: Non-printable character cleaning\n');

test('URL with Zero-Width Space should be cleaned', () => {
  const urlWithZWS = 'https://github.com/owner/repo\u200B'; // Zero-Width Space at end
  const result = validateGitHubUrl([urlWithZWS], hiveOptions);
  return result.valid && !result.normalizedUrl.includes('\u200B');
});

test('URL with BOM should be cleaned', () => {
  const urlWithBOM = '\uFEFFhttps://github.com/owner/repo'; // BOM at start
  const result = validateGitHubUrl([urlWithBOM], hiveOptions);
  return result.valid && !result.normalizedUrl.includes('\uFEFF');
});

test('URL with Zero-Width Non-Joiner should be cleaned', () => {
  const urlWithZWNJ = 'https://github.com/owner\u200Crepo/issues'; // ZWNJ in path
  // This might fail URL parsing since it breaks the path, but should clean the char
  const cleaned = cleanNonPrintableChars(urlWithZWNJ);
  return !cleaned.includes('\u200C');
});

console.log('\nTest Suite 4: Error message escaping\n');

test('Error message should escape underscores in URLs', () => {
  const urlWithUnderscore = 'https://github.com/owner/my_repo';
  // Using solve options to trigger error for issues/123 (wrong type for solve command)
  // But actually we need a URL type that's not allowed, so let's test with /solve
  // For solve, a repo URL is not allowed
  const solveOpts = {
    allowedTypes: ['issue', 'pull'],
    commandName: 'solve',
  };
  const result = validateGitHubUrl([urlWithUnderscore], solveOpts);
  // Check that the error message escapes underscores - the URL appears in the error message
  // The escapeMarkdown is called on the URL which has underscore
  return result.valid === false && result.error.includes('\\_');
});

test('escapeMarkdown should escape underscores', () => {
  const text = 'my_repo';
  const escaped = escapeMarkdown(text);
  return escaped === 'my\\_repo';
});

test('escapeMarkdown should escape asterisks', () => {
  const text = 'bold*text*';
  const escaped = escapeMarkdown(text);
  return escaped === 'bold\\*text\\*';
});

console.log('\nTest Suite 5: /solve command should still reject issues_list\n');

const solveOptions = {
  allowedTypes: ['issue', 'pull'],
  commandName: 'solve',
};

test('issues_list URL should be rejected for /solve', () => {
  const result = validateGitHubUrl(['https://github.com/owner/repo/issues'], solveOptions);
  return result.valid === false && result.error.includes('issues list page');
});

test('pulls_list URL should be rejected for /solve', () => {
  const result = validateGitHubUrl(['https://github.com/owner/repo/pulls'], solveOptions);
  return result.valid === false && result.error.includes('pull requests list');
});

test('Specific issue URL should still be valid for /solve', () => {
  const result = validateGitHubUrl(['https://github.com/owner/repo/issues/123'], solveOptions);
  return result.valid === true;
});

test('Specific PR URL should still be valid for /solve', () => {
  const result = validateGitHubUrl(['https://github.com/owner/repo/pull/456'], solveOptions);
  return result.valid === true;
});

console.log('\n===========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('===========================================\n');

if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
}

console.log('✅ All Issue #1102 fix tests passed!');
