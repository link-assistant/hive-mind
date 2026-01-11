// Test the exact error message construction for /hive command
// This simulates what validateGitHubUrl does when the URL type is not allowed

import { parseGitHubUrl } from '../../src/github.lib.mjs';

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

  // Check if the URL type is allowed for this command
  if (!allowedTypes.includes(parsed.type)) {
    const allowedTypesStr = allowedTypes.map(t => (t === 'pull' ? 'pull request' : t)).join(', ');
    const baseUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;

    let error;
    if (parsed.type === 'issues_list') {
      error = `URL points to the issues list page, but you need a specific issue\n\n💡 How to fix:\n1. Open the repository: ${url}\n2. Click on a specific issue\n3. Copy the URL (it should end with /issues/NUMBER)\n\nExample: \`${baseUrl}/issues/1\``;
    } else if (parsed.type === 'pulls_list') {
      error = `URL points to the pull requests list page, but you need a specific pull request\n\n💡 How to fix:\n1. Open the repository: ${url}\n2. Click on a specific pull request\n3. Copy the URL (it should end with /pull/NUMBER)\n\nExample: \`${baseUrl}/pull/1\``;
    } else if (parsed.type === 'repo') {
      error = `URL points to a repository, but you need a specific ${allowedTypesStr}\n\n💡 How to fix:\n1. Go to: ${url}/issues\n2. Click on an issue to solve\n3. Use the full URL with the issue number\n\nExample: \`${baseUrl}/issues/1\``;
    } else {
      error = `URL must be a GitHub ${allowedTypesStr} (not ${parsed.type.replace('_', ' ')})`;
    }

    return { valid: false, error };
  }

  return { valid: true };
}

// Test the exact error message for /hive with issues list URL
const testUrl = 'https://github.com/VisageDvachevsky/StoryGraph/issues';
const validation = validateGitHubUrl([testUrl], {
  allowedTypes: ['repo', 'organization', 'user'],
  commandName: 'hive',
  exampleUrl: 'https://github.com/owner/repo',
});

console.log('Validation result:', JSON.stringify(validation, null, 2));

// The error message that will be shown
const errorMsg = `❌ ${validation.error}\n\nExample: \`/hive https://github.com/owner/repo\``;

console.log('\n\nError message sent to Telegram:');
console.log('-'.repeat(60));
console.log(errorMsg);
console.log('-'.repeat(60));

// Now let's check what byte offset 61 refers to in the error message
const msgBytes = Buffer.from(errorMsg, 'utf8');
console.log('\n\nAnalysis of error message:');
console.log('Total length in bytes:', msgBytes.length);
console.log('Byte offset 61 corresponds to:');
console.log('  Position:', 61);
console.log('  Character at offset 61:', errorMsg.charAt(61));
console.log('  Context around offset 61:', errorMsg.substring(55, 70));

// Check for backtick characters which can cause markdown parsing issues
console.log('\nBacktick positions in message:');
for (let i = 0; i < errorMsg.length; i++) {
  if (errorMsg[i] === '`') {
    console.log(`  Found backtick at position ${i}: "${errorMsg.substring(Math.max(0, i - 5), Math.min(errorMsg.length, i + 10))}"`);
  }
}

// Check for underscore characters which can cause markdown parsing issues
console.log('\nUnderscore positions in message (can break Telegram Markdown):');
for (let i = 0; i < errorMsg.length; i++) {
  if (errorMsg[i] === '_') {
    console.log(`  Found _ at position ${i}: "${errorMsg.substring(Math.max(0, i - 5), Math.min(errorMsg.length, i + 10))}"`);
  }
}

// The issue: for /hive, the error message says "you need a specific issue" but /hive doesn't need issues!
// This is the WRONG error message for /hive command
console.log('\n\n⚠️ NOTE: The error message for issues_list is designed for /solve command,');
console.log('   but /hive command uses issues_list type differently - it should allow it or show proper error.');
