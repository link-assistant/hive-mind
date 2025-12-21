#!/usr/bin/env node

// Integration test for the GitHub token masking feature
console.log('🧪 Integration test for GitHub token masking...\n');

const fs = (await import('fs')).promises;
const os = (await import('os')).default;
const path = (await import('path')).default;

// Helper function to mask GitHub tokens in text
const maskGitHubToken = token => {
  if (!token || token.length < 12) {
    return token;
  }

  const start = token.substring(0, 5);
  const end = token.substring(token.length - 5);
  const middle = '*'.repeat(Math.max(token.length - 10, 3));

  return start + middle + end;
};

// Helper function to get GitHub tokens from local config files
const getGitHubTokensFromFiles = async () => {
  const tokens = [];

  try {
    // Check ~/.config/gh/hosts.yml
    const hostsFile = path.join(os.homedir(), '.config/gh/hosts.yml');
    if (
      await fs
        .access(hostsFile)
        .then(() => true)
        .catch(() => false)
    ) {
      const hostsContent = await fs.readFile(hostsFile, 'utf8');

      // Look for oauth_token and api_token patterns
      const oauthMatches = hostsContent.match(/oauth_token:\s*([^\s\n]+)/g);
      if (oauthMatches) {
        for (const match of oauthMatches) {
          const token = match.split(':')[1].trim();
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }

      const apiMatches = hostsContent.match(/api_token:\s*([^\s\n]+)/g);
      if (apiMatches) {
        for (const match of apiMatches) {
          const token = match.split(':')[1].trim();
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
    }
  } catch (error) {
    // Silently ignore file access errors
  }

  return tokens;
};

// Helper function to sanitize log content by masking GitHub tokens
const sanitizeLogContent = async logContent => {
  let sanitized = logContent;

  try {
    // Get tokens from file sources
    const fileTokens = await getGitHubTokensFromFiles();
    const allTokens = [...new Set(fileTokens)];

    // Mask each token found
    for (const token of allTokens) {
      if (token && token.length >= 12) {
        const maskedToken = maskGitHubToken(token);
        sanitized = sanitized.split(token).join(maskedToken);
      }
    }

    // Also look for and mask common GitHub token patterns directly in the log
    const tokenPatterns = [/gh[pou]_[a-zA-Z0-9_]{20,}/g, /(?:^|[\s:="])([a-f0-9]{40})(?=[\s\n"]|$)/gm, /(?:token[:\s"]*)([a-zA-Z0-9_]{20,})/gi];

    for (const pattern of tokenPatterns) {
      sanitized = sanitized.replace(pattern, (match, token) => {
        if (token && token.length >= 20) {
          return match.replace(token, maskGitHubToken(token));
        }
        return match;
      });
    }

    console.log(`  🔒 Sanitized ${allTokens.length} detected GitHub tokens from config files`);
  } catch (error) {
    console.log(`  ⚠️  Warning: Could not fully sanitize log content: ${error.message}`);
  }

  return sanitized;
};

console.log('1. Testing file-based token detection...');
const tokens = await getGitHubTokensFromFiles();
console.log(`   Found ${tokens.length} tokens in config files`);
for (const token of tokens) {
  console.log(`   Token: ${maskGitHubToken(token)} (masked for display)`);
}

console.log('\n2. Testing full log sanitization...');
const testLog = `
[INFO] GitHub authentication successful
[DEBUG] Using token: ${tokens[0] || 'ghp_example1234567890abcdef1234567890abcdef123'}
[INFO] Repository cloned successfully
[DEBUG] Config file contains: oauth_token: ${tokens[0] || 'ghp_example1234567890abcdef1234567890abcdef123'}
[INFO] Pull request created
`;

console.log('Original log:');
console.log(testLog);

const sanitizedLog = await sanitizeLogContent(testLog);

console.log('Sanitized log:');
console.log(sanitizedLog);

console.log('\n3. Verification...');
const hasMaskedTokens = sanitizedLog.includes('*') && !testLog.includes('*');
console.log(`   ✅ Tokens were masked: ${hasMaskedTokens ? 'YES' : 'NO'}`);

const originalTokenPresent = tokens.some(token => sanitizedLog.includes(token)) || sanitizedLog.includes('ghp_example1234567890abcdef1234567890abcdef123');
console.log(`   ✅ Original tokens removed: ${!originalTokenPresent ? 'YES' : 'NO'}`);

console.log('\n🧪 Integration test complete!');

console.log('\n📋 RESULTS:');
console.log(`   • Detected ${tokens.length} tokens from GitHub config files`);
console.log(`   • Log sanitization ${hasMaskedTokens ? 'PASSED' : 'FAILED'}`);
console.log(`   • Token removal ${!originalTokenPresent ? 'PASSED' : 'FAILED'}`);
