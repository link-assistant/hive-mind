#!/usr/bin/env node

// Test script to deliberately trigger rate limits and capture exact error patterns
// This will help us understand exactly how to detect rate limit errors

const { execSync } = await import('child_process');

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function rapidFireRequests() {
  log(`🚀 Starting rapid-fire requests to trigger rate limits...`);
  log(`📊 Current rate limit status: 18 remaining (from previous test)`);

  const searchCommands = [
    'gh search issues "is:issue is:open" --limit 5',
    'gh search issues "language:javascript" --limit 5',
    'gh search issues "bug" --limit 5',
    'gh search issues "enhancement" --limit 5',
    'gh search issues "documentation" --limit 5',
    'gh search issues "help wanted" --limit 5',
    'gh search issues "good first issue" --limit 5',
    'gh search issues "react" --limit 5',
    'gh search issues "vue" --limit 5',
    'gh search issues "python" --limit 5',
    'gh search issues "node" --limit 5',
    'gh search issues "typescript" --limit 5',
    'gh search issues "docker" --limit 5',
    'gh search issues "api" --limit 5',
    'gh search issues "cli" --limit 5',
    'gh search issues "frontend" --limit 5',
    'gh search issues "backend" --limit 5',
    'gh search issues "performance" --limit 5',
    'gh search issues "security" --limit 5',
    'gh search issues "testing" --limit 5'
  ];

  for (let i = 0; i < searchCommands.length; i++) {
    const command = searchCommands[i];
    const requestNum = i + 1;

    log(`\n📋 Request ${requestNum}/${searchCommands.length}: ${command}`);

    try {
      const startTime = Date.now();
      const output = execSync(command + ' --json url,title,number', {
        encoding: 'utf8',
        stdio: 'pipe'
      });
      const endTime = Date.now();

      const data = JSON.parse(output || '[]');
      log(`   ✅ Success: ${data.length} results in ${endTime - startTime}ms`);

      // If this is every 5th request, check rate limit status
      if (requestNum % 5 === 0) {
        try {
          const rateLimitCheck = execSync('gh api rate_limit', { encoding: 'utf8' });
          const rateLimitData = JSON.parse(rateLimitCheck);
          const searchRate = rateLimitData.resources?.search;
          if (searchRate) {
            log(
              `   📊 Rate limit check: ${searchRate.remaining}/${searchRate.limit} remaining, resets at ${new Date(searchRate.reset * 1000).toISOString()}`
            );
          }
        } catch (rateLimitError) {
          log(`   ⚠️  Could not check rate limit: ${rateLimitError.message}`);
        }
      }
    } catch (error) {
      const stderr = error.stderr?.toString() || '';
      const stdout = error.stdout?.toString() || '';
      const combinedOutput = stderr + stdout;

      log(`   ❌ Error (code ${error.status}):`);
      log(`      Full error: ${combinedOutput.trim()}`);

      // Analyze the error for rate limit patterns
      const rateLimitPatterns = [
        /rate limit/i,
        /API rate limit/i,
        /secondary rate limit/i,
        /abuse detection/i,
        /too many requests/i,
        /403.*forbidden/i,
        /retry.*after/i,
        /wait.*before/i,
        /exceeded.*limit/i
      ];

      const isRateLimit = rateLimitPatterns.some(pattern => pattern.test(combinedOutput));

      if (isRateLimit) {
        log(`   🚨 RATE LIMIT ERROR DETECTED!`);
        log(`   📝 Error pattern analysis:`);

        rateLimitPatterns.forEach((pattern, idx) => {
          if (pattern.test(combinedOutput)) {
            log(`      ✓ Pattern ${idx + 1} matched: ${pattern.source}`);
          }
        });

        // Extract any numbers that might indicate retry time
        const retryAfterMatch = combinedOutput.match(/(\d+)\s*(?:seconds?|minutes?|hours?)/i);
        if (retryAfterMatch) {
          log(`   ⏰ Retry time found: ${retryAfterMatch[0]}`);
        }

        // Check if we can get more detailed rate limit info
        try {
          const rateLimitInfo = execSync('gh api rate_limit', { encoding: 'utf8' });
          log(`   📊 Detailed rate limit info:`);
          log(`      ${rateLimitInfo.trim()}`);
        } catch (rateLimitInfoError) {
          log(`   ⚠️  Could not get detailed rate limit info: ${rateLimitInfoError.message}`);
        }

        log(`   🛑 Stopping test - rate limit reached!`);
        break;
      } else {
        log(`   ❓ Non-rate-limit error - continuing...`);
      }
    }

    // Small delay to avoid overwhelming
    if (i < searchCommands.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function testFallbackScenario() {
  log(`\n🔄 Testing fallback scenario: search API vs repository listing`);

  // Test 1: Try search API (might fail due to rate limits)
  log(`\n📋 Fallback Test 1: Search API`);
  try {
    const searchResult = execSync(
      'gh search issues "repo:microsoft/vscode is:open" --limit 10 --json url,title,number',
      {
        encoding: 'utf8',
        stdio: 'pipe'
      }
    );
    const searchData = JSON.parse(searchResult || '[]');
    log(`   ✅ Search API: ${searchData.length} results`);
  } catch (searchError) {
    const errorText = searchError.stderr?.toString() || searchError.stdout?.toString() || '';
    log(`   ❌ Search API failed: ${errorText.trim()}`);

    // Test fallback to repository listing
    log(`\n📋 Fallback Test 2: Repository listing API (fallback)`);
    try {
      const repoResult = execSync(
        'gh issue list --repo microsoft/vscode --state open --limit 10 --json url,title,number',
        {
          encoding: 'utf8',
          stdio: 'pipe'
        }
      );
      const repoData = JSON.parse(repoResult || '[]');
      log(`   ✅ Repository listing (fallback): ${repoData.length} results`);
      log(`   💡 Fallback strategy would work!`);
    } catch (repoError) {
      const repoErrorText = repoError.stderr?.toString() || repoError.stdout?.toString() || '';
      log(`   ❌ Repository listing also failed: ${repoErrorText.trim()}`);
    }
  }
}

async function checkMaxPageSizes() {
  log(`\n📏 Testing maximum page sizes for different APIs`);

  const apis = [
    {
      name: 'Search Issues API',
      command: 'gh search issues "is:issue" --limit LIMIT --json url,title,number',
      limits: [100, 500, 1000, 2000]
    },
    {
      name: 'Repository Issues API',
      command: 'gh issue list --repo microsoft/vscode --state open --limit LIMIT --json url,title,number',
      limits: [100, 500, 1000, 2000]
    },
    {
      name: 'Repository PRs API',
      command: 'gh pr list --repo microsoft/vscode --state open --limit LIMIT --json url,title,number',
      limits: [100, 500, 1000, 2000]
    }
  ];

  for (const api of apis) {
    log(`\n📋 Testing ${api.name}:`);

    for (const limit of api.limits) {
      const command = api.command.replace('LIMIT', limit.toString());
      log(`   Testing limit ${limit}...`);

      try {
        const startTime = Date.now();
        const result = execSync(command, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 30000 // 30 second timeout
        });
        const endTime = Date.now();

        const data = JSON.parse(result || '[]');
        log(`      ✅ Success: ${data.length} items in ${endTime - startTime}ms`);

        if (data.length < limit) {
          log(`      ℹ️  Got fewer results than requested (${data.length} < ${limit}) - may have reached actual limit`);
        }
      } catch (error) {
        const errorText = error.stderr?.toString() || error.stdout?.toString() || '';
        log(`      ❌ Failed at limit ${limit}: ${errorText.trim()}`);

        if (errorText.includes('limit') || errorText.includes('too large') || errorText.includes('maximum')) {
          log(`      🚫 Maximum page size appears to be less than ${limit}`);
        }
        break; // Stop testing higher limits for this API
      }
    }
  }
}

async function main() {
  log(`🔬 GitHub CLI Rate Limit Error Pattern Detection`);
  log(`This test will help identify exact error messages and patterns for rate limit detection\n`);

  // First, check current rate limit status
  try {
    const rateLimitStatus = execSync('gh api rate_limit', { encoding: 'utf8' });
    const rateLimitData = JSON.parse(rateLimitStatus);
    const searchRate = rateLimitData.resources?.search;
    if (searchRate) {
      log(`📊 Initial rate limit status: ${searchRate.remaining}/${searchRate.limit} search requests remaining`);
      log(`   Resets at: ${new Date(searchRate.reset * 1000).toISOString()}`);
    }
  } catch (error) {
    log(`⚠️  Could not check initial rate limit status`);
  }

  // Test 1: Try to trigger rate limits
  await rapidFireRequests();

  // Test 2: Test fallback scenario
  await testFallbackScenario();

  // Test 3: Check maximum page sizes
  await checkMaxPageSizes();

  log(`\n✅ Rate limit error pattern testing completed`);
}

await main();
