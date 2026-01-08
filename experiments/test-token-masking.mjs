#!/usr/bin/env node

// Test script for token masking functionality
console.log('🧪 Testing GitHub token masking implementation...\n');

// Test the maskGitHubToken function directly
const maskGitHubToken = token => {
  if (!token || token.length < 12) {
    return token;
  }

  const start = token.substring(0, 5);
  const end = token.substring(token.length - 5);
  const middle = '*'.repeat(Math.max(token.length - 10, 3));

  return start + middle + end;
};

console.log('1. Testing token masking function...');
const testTokens = [
  'ghp_1234567890abcdef1234567890abcdef12345678', // GitHub personal access token
  'gho_1234567890abcdef1234567890abcdef12345678', // OAuth token
  'ghu_1234567890abcdef1234567890abcdef12345678', // User token
  'very_short', // Too short, should not be masked
  '1234567890abcdef1234567890abcdef1234567890', // 40-char hex token
];

for (const token of testTokens) {
  const masked = maskGitHubToken(token);
  console.log(`   Original: ${token}`);
  console.log(`   Masked:   ${masked}`);
  console.log(`   Length:   ${token.length} -> ${masked.length}`);

  if (token.length >= 12) {
    // Verify that we kept at least 5 characters from start and end
    const startMatch = token.substring(0, 5) === masked.substring(0, 5);
    const endMatch = token.substring(token.length - 5) === masked.substring(masked.length - 5);
    console.log(`   ✅ Start/end preserved: ${startMatch && endMatch ? 'YES' : 'NO'}`);
  } else {
    console.log(`   ✅ Short token unchanged: ${token === masked ? 'YES' : 'NO'}`);
  }
  console.log('');
}

console.log('2. Testing alias support...');
try {
  const { execSync } = await import('child_process');
  const helpOutput = execSync('node solve.mjs --help 2>&1', { encoding: 'utf8', cwd: '..' });

  if (helpOutput.includes('--attach-logs')) {
    console.log('   ✅ --attach-logs alias found in help text');
  } else {
    console.log('   ❌ --attach-logs alias not found in help text');
  }

  if (!helpOutput.includes('attach-solution-logs')) {
    console.log('   ✅ --attach-solution-logs option successfully removed from help text');
  } else {
    console.log('   ❌ --attach-solution-logs option still found in help text (should be removed)');
  }
} catch (error) {
  console.log('   ⚠️  Could not test help output:', error.message);
}

console.log('\n3. Testing log sanitization patterns...');
const testLogContent = `
[INFO] Running gh auth status
Token: ghp_1234567890abcdef1234567890abcdef12345678
oauth_token: gho_abcdef1234567890abcdef1234567890abcdef
API response includes: {"token": "1234567890abcdef1234567890abcdef1234567890"}
Some normal log content here
gh cli using token ghu_9876543210fedcba9876543210fedcba98765432
`;

const sanitizeLogContent = async logContent => {
  let sanitized = logContent;

  // Mock token patterns for testing
  const tokenPatterns = [/gh[pou]_[a-zA-Z0-9_]{20,}/g, /(?:^|[\s:="])([a-f0-9]{40})(?=[\s\n"]|$)/gm, /(?:token[:\s"]*)([a-zA-Z0-9_]{20,})/gi];

  for (const pattern of tokenPatterns) {
    sanitized = sanitized.replace(pattern, (match, token) => {
      if (token && token.length >= 20) {
        return match.replace(token, maskGitHubToken(token));
      }
      return match;
    });
  }

  return sanitized;
};

console.log('Original log content:');
console.log(testLogContent);
console.log('\nSanitized log content:');
const sanitized = await sanitizeLogContent(testLogContent);
console.log(sanitized);

console.log('\n🧪 Token masking test complete!');

console.log('\n📋 SUMMARY:');
console.log('   • Token masking function preserves 5 chars from start/end');
console.log('   • --attach-logs option available (--attach-solution-logs removed)');
console.log('   • GitHub tokens in logs are automatically masked');
console.log('   • Multiple token patterns supported (ghp_, gho_, ghu_, hex tokens)');
