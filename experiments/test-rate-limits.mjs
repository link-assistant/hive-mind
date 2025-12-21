#!/usr/bin/env node

// Test script to understand GitHub CLI rate limit errors and API behavior
// This script will help identify:
// 1. How rate limit errors appear in GitHub CLI
// 2. Maximum page sizes for different APIs
// 3. Typical error messages and patterns

const { execSync } = await import('child_process');

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function testGitHubCommand(description, command, expectError = false) {
  log(`\n📋 ${description}`);
  log(`   Command: ${command}`);

  try {
    const startTime = Date.now();
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const endTime = Date.now();

    if (!expectError) {
      const data = JSON.parse(output || '[]');
      log(`   ✅ Success: ${Array.isArray(data) ? data.length : 'N/A'} items in ${endTime - startTime}ms`);
      return { success: true, data, output, duration: endTime - startTime };
    } else {
      log(`   ⚠️  Expected error but command succeeded`);
      return { success: true, data: JSON.parse(output || '[]'), output, duration: endTime - startTime };
    }
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    const combinedOutput = stderr + stdout;

    log(`   ❌ Error (code ${error.status}):`);
    log(`      Stderr: ${stderr.trim()}`);
    if (stdout.trim()) {
      log(`      Stdout: ${stdout.trim()}`);
    }

    // Check for rate limit indicators
    const isRateLimit =
      combinedOutput.includes('rate limit') ||
      combinedOutput.includes('API rate limit') ||
      combinedOutput.includes('secondary rate limit') ||
      combinedOutput.includes('403') ||
      combinedOutput.includes('abuse') ||
      combinedOutput.includes('too many requests') ||
      combinedOutput.includes('retry-after');

    if (isRateLimit) {
      log(`   🚨 RATE LIMIT DETECTED!`);
    }

    return {
      success: false,
      error: combinedOutput,
      isRateLimit,
      statusCode: error.status
    };
  }
}

async function main() {
  log(`🔬 GitHub CLI Rate Limit and API Testing`);
  log(`Testing different GitHub CLI commands to understand rate limits and page sizes\n`);

  // Test 1: Basic search API with small limit
  await testGitHubCommand(
    'Test 1: Search API with small limit (10 items)',
    'gh search issues "is:issue is:open" --limit 10 --json url,title,number'
  );

  // Test 2: Search API with medium limit
  await testGitHubCommand(
    'Test 2: Search API with medium limit (100 items)',
    'gh search issues "is:issue is:open" --limit 100 --json url,title,number'
  );

  // Test 3: Search API with high limit to test maximum
  await testGitHubCommand(
    'Test 3: Search API with high limit (1000 items) - may hit limits',
    'gh search issues "is:issue is:open" --limit 1000 --json url,title,number'
  );

  // Test 4: Repository listing API for comparison
  const testRepo = 'microsoft/vscode'; // A repo with many issues
  await testGitHubCommand(
    'Test 4: Repository listing API with high limit (1000 items)',
    `gh issue list --repo ${testRepo} --state open --limit 1000 --json url,title,number`
  );

  // Test 5: Multiple rapid search calls to trigger rate limits
  log(`\n📋 Test 5: Multiple rapid search calls to test rate limits`);
  for (let i = 1; i <= 5; i++) {
    await testGitHubCommand(
      `Rapid call ${i}/5`,
      `gh search issues "is:issue is:open repo:${testRepo}" --limit 30 --json url,title,number`
    );

    if (i < 5) {
      log(`   ⏱️  No delay between calls (${i}/4)`);
    }
  }

  // Test 6: Test org-scope search
  await testGitHubCommand(
    'Test 6: Organization-scope search',
    'gh search issues "org:microsoft is:open" --limit 100 --json url,title,number,repository'
  );

  // Test 7: Test user-scope search
  await testGitHubCommand(
    'Test 7: User-scope search',
    'gh search issues "user:torvalds is:open" --limit 100 --json url,title,number,repository'
  );

  // Test 8: Test API endpoint directly to see raw responses
  log(`\n📋 Test 8: Direct API call to see raw rate limit headers`);
  try {
    const apiResult = execSync('gh api "/search/issues?q=is:issue+is:open&per_page=10" --include', {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    log(`   ✅ API call successful`);

    // Look for rate limit headers in the response
    const headers = apiResult
      .split('\n')
      .filter(line => line.toLowerCase().includes('rate-limit') || line.toLowerCase().includes('x-ratelimit'));

    if (headers.length > 0) {
      log(`   📊 Rate limit headers found:`);
      headers.forEach(header => log(`      ${header.trim()}`));
    } else {
      log(`   ℹ️  No rate limit headers found in output`);
    }
  } catch (error) {
    log(`   ❌ Direct API call failed: ${error.message}`);
  }

  log(`\n✅ Testing completed`);
  log(`\n📝 Summary:`);
  log(`   • Search API errors typically include terms like 'rate limit', '403', 'abuse'`);
  log(`   • Repository listing API may have different limits than search API`);
  log(`   • Rate limit headers provide information about remaining requests`);
  log(`   • Multiple rapid calls can trigger secondary rate limits`);
}

// Run the tests
await main();
