// Test the exact error scenario for issue #1102
// This replicates the error message that gets sent to Telegram

import { parseGitHubUrl } from '../../src/github.lib.mjs';
import { escapeMarkdown } from '../../src/telegram-markdown.lib.mjs';

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
      // This error message is designed for /solve command, NOT /hive!
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

// Build the exact error message as sent in telegram-bot.mjs lines 1183-1188
let errorMsg = `❌ ${validation.error}`;
if (validation.suggestion) {
  errorMsg += `\n\n💡 Did you mean: \`${validation.suggestion}\``;
}
errorMsg += '\n\nExample: `/hive https://github.com/owner/repo`';

console.log('='.repeat(80));
console.log('FULL ERROR MESSAGE SENT TO TELEGRAM:');
console.log('='.repeat(80));
console.log(errorMsg);
console.log('='.repeat(80));

// Analyze the markdown issues
console.log('\n\nMARKDOWN ANALYSIS:');
console.log('-'.repeat(80));

// Count backticks
const backticks = [...errorMsg.matchAll(/`/g)];
console.log(`Number of backticks: ${backticks.length}`);
console.log('Backtick positions:');
for (let i = 0; i < backticks.length; i++) {
  const pos = backticks[i].index;
  console.log(`  ${i + 1}. Position ${pos}: "${errorMsg.substring(Math.max(0, pos - 3), Math.min(errorMsg.length, pos + 20))}"`);
}

console.log(`\n⚠️ ISSUE: ${backticks.length} backticks means ${backticks.length % 2 === 0 ? 'EVEN (OK)' : 'ODD (PROBLEM!)'}`);

// In Telegram's Markdown, backticks must be paired.
// If we have: `...` it's fine
// If we have: ` without closing, it causes "Can't find end of entity"

console.log('\n\nBYTE OFFSET 61 ANALYSIS:');
console.log('-'.repeat(80));
const msgBytes = Buffer.from(errorMsg, 'utf8');
console.log(`Message total bytes: ${msgBytes.length}`);
console.log(`Byte at offset 61: 0x${msgBytes[61].toString(16)}`);
console.log(`Character at byte offset 61: "${String.fromCharCode(msgBytes[61])}"`);

// Get context around byte offset 61
let charOffset = 0;
let byteOffset = 0;
for (let i = 0; i < errorMsg.length; i++) {
  const charBytes = Buffer.from(errorMsg[i], 'utf8').length;
  if (byteOffset <= 61 && byteOffset + charBytes > 61) {
    charOffset = i;
    break;
  }
  byteOffset += charBytes;
}
console.log(`Character offset for byte 61: ${charOffset}`);
console.log(`Context: "${errorMsg.substring(Math.max(0, charOffset - 10), Math.min(errorMsg.length, charOffset + 20))}"`);

console.log('\n\n💡 ROOT CAUSE HYPOTHESIS:');
console.log('-'.repeat(80));
console.log('1. The error message contains inline code blocks using backticks');
console.log('2. The URL contains underscores (StoryGraph) which are NOT escaped');
console.log('3. However, the error at byte offset 61 is likely in the emoji or URL');
console.log('4. Telegram Markdown parser encounters unescaped special characters');
console.log('5. This causes "can\'t find end of entity" error');

console.log('\n\n✅ SOLUTION:');
console.log('-'.repeat(80));
console.log('1. The /hive command should ALLOW issues_list URLs (redirect to repo)');
console.log('2. Error messages should escape special chars with escapeMarkdown()');
console.log('3. URLs in error messages need proper escaping for Markdown');
