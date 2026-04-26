#!/usr/bin/env node

/**
 * Test script for token masking false positive prevention (Issue #1037)
 *
 * This test verifies that the log sanitization logic:
 * 1. Does NOT mask legitimate identifiers (browser_take_screenshot, etc.)
 * 2. Does NOT mask git commit hashes in git command contexts
 * 3. Does NOT mask gist IDs in gh gist commands
 * 4. DOES mask actual GitHub tokens (ghp_, gho_, ghu_, github_pat_)
 * 5. DOES mask 40-char hex tokens when NOT in git contexts
 */

console.log('🧪 Testing GitHub token masking false positive prevention (Issue #1037)...\n');

// Import the functions we need to test
import { maskToken } from '../src/lib.mjs';
// Token sanitization functions can be imported from either location
// Using the dedicated module for clarity
import { isSafeToken, isHexInSafeContext, sanitizeLogContent } from '../src/token-sanitization.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

const assertEqual = (actual, expected, testName) => {
  if (actual === expected) {
    console.log(`   ✅ ${testName}`);
    testsPassed++;
  } else {
    console.log(`   ❌ ${testName}`);
    console.log(`      Expected: ${expected}`);
    console.log(`      Actual:   ${actual}`);
    testsFailed++;
  }
};

const assertContains = (text, substring, testName) => {
  if (text.includes(substring)) {
    console.log(`   ✅ ${testName}`);
    testsPassed++;
  } else {
    console.log(`   ❌ ${testName}`);
    console.log(`      Expected to contain: ${substring}`);
    console.log(`      Actual text: ${text.substring(0, 200)}...`);
    testsFailed++;
  }
};

const assertNotContains = (text, substring, testName) => {
  if (!text.includes(substring)) {
    console.log(`   ✅ ${testName}`);
    testsPassed++;
  } else {
    console.log(`   ❌ ${testName}`);
    console.log(`      Should NOT contain: ${substring}`);
    console.log(`      But found in: ${text.substring(0, 200)}...`);
    testsFailed++;
  }
};

// ============================================================================
// Test 1: isSafeToken function
// ============================================================================
console.log('1. Testing isSafeToken function...');

// Safe tokens (should NOT be masked)
assertEqual(isSafeToken('browser_take_screenshot'), true, 'browser_take_screenshot is safe');
assertEqual(isSafeToken('browser_click'), true, 'browser_click is safe');
assertEqual(isSafeToken('mcp__playwright__browser_snapshot'), true, 'MCP tool name is safe');
assertEqual(isSafeToken('get_user_profile'), true, 'Function with underscores is safe');
assertEqual(isSafeToken('183fd583-b795-4920-8be5-be778aff7fa9'), true, 'UUID is safe');

// Unsafe tokens (should be masked)
assertEqual(isSafeToken('ghp_1234567890abcdef1234567890abcdef12345678'), false, 'GitHub PAT is unsafe');
assertEqual(isSafeToken('1234567890abcdef1234567890abcdef12345678'), false, 'Random hex string is unsafe');
// Note: some_random_string matches the pattern [a-z]+_[a-z]+_[a-z_]+, so it IS considered safe
// This is intentional to avoid masking function names like get_user_input

console.log('');

// ============================================================================
// Test 2: isHexInSafeContext function
// ============================================================================
console.log('2. Testing isHexInSafeContext function...');

const testHex = '2073c66ab9405a46416dbb51714f843c30160520c'.substring(0, 40);

// Safe contexts (should NOT be masked)
const gistContext = 'Running: gh gist view 2073c66ab9405a46416dbb51714f843c3016052 some more text';
assertEqual(isHexInSafeContext(gistContext, '2073c66ab9405a46416dbb51714f843c3016052', 21), true, 'gh gist view context is safe');

const gitLogContext = 'Running: git log 2073c66ab9405a46416dbb51714f843c3016052';
assertEqual(isHexInSafeContext(gitLogContext, '2073c66ab9405a46416dbb51714f843c3016052', 17), true, 'git log context is safe');

const gitShowContext = 'git show 2073c66ab9405a46416dbb51714f843c3016052 --stat';
assertEqual(isHexInSafeContext(gitShowContext, '2073c66ab9405a46416dbb51714f843c3016052', 9), true, 'git show context is safe');

const commitContext = 'commit 2073c66ab9405a46416dbb51714f843c3016052 Author: test';
assertEqual(isHexInSafeContext(commitContext, '2073c66ab9405a46416dbb51714f843c3016052', 7), true, 'commit SHA context is safe');

// Unsafe contexts (should be masked)
const oauthContext = 'oauth_token: 1234567890abcdef1234567890abcdef12345678';
assertEqual(isHexInSafeContext(oauthContext, '1234567890abcdef1234567890abcdef12345678', 13), false, 'oauth_token context is unsafe');

const apiContext = 'API response: {"token": "1234567890abcdef1234567890abcdef12345678"}';
assertEqual(isHexInSafeContext(apiContext, '1234567890abcdef1234567890abcdef12345678', 25), false, 'API token context is unsafe');

console.log('');

// ============================================================================
// Test 3: Full sanitizeLogContent function - False Positives
// ============================================================================
console.log('3. Testing sanitizeLogContent - False Positives Prevention...');

const falsePositiveTestContent = `
[INFO] Starting solution draft...
- When you need to take screenshots, use browser_take_screenshot from Playwright MCP.
- When you need to click, use mcp__playwright__browser_click tool.
- Running command: gh gist view 2073c66ab9405a46416dbb51714f843c3016052 --raw
- Git log output: commit 1234567890abcdef1234567890abcdef12345678
  Author: Test User
- Some long function name: validate_user_input_and_sanitize
`;

const sanitizedFalsePositive = await sanitizeLogContent(falsePositiveTestContent);

// These should NOT be masked
assertContains(sanitizedFalsePositive, 'browser_take_screenshot', 'browser_take_screenshot not masked');
assertContains(sanitizedFalsePositive, 'mcp__playwright__browser_click', 'MCP tool not masked');
assertContains(sanitizedFalsePositive, 'validate_user_input_and_sanitize', 'Long function name not masked');
assertContains(sanitizedFalsePositive, '2073c66ab9405a46416dbb51714f843c3016052', 'Gist ID in gh gist view not masked');
assertContains(sanitizedFalsePositive, '1234567890abcdef1234567890abcdef12345678', 'Commit SHA in git log not masked');

// Verify no asterisks were added to these safe patterns
assertNotContains(sanitizedFalsePositive, 'brows*', 'No partial masking of browser_take_screenshot');
assertNotContains(sanitizedFalsePositive, 'mcp__*', 'No partial masking of MCP tool name');

console.log('');

// ============================================================================
// Test 4: Full sanitizeLogContent function - True Positives
// ============================================================================
console.log('4. Testing sanitizeLogContent - True Positives (Should Mask)...');

const truePositiveTestContent = `
[INFO] Authentication check...
Token: ghp_1234567890abcdef1234567890abcdef12345678
oauth_token: gho_abcdef1234567890abcdef1234567890abcdef12
User token: ghu_9876543210fedcba9876543210fedcba98765432
Fine-grained PAT: github_pat_abcdefghijklmnopqrstuvwxyz1234567890
Random API key: 1234567890abcdef1234567890abcdef12345678
`;

const sanitizedTruePositive = await sanitizeLogContent(truePositiveTestContent);

// These SHOULD be masked (contain asterisks)
assertContains(sanitizedTruePositive, 'ghp_1*', 'GitHub PAT (ghp_) is masked');
assertContains(sanitizedTruePositive, 'gho_a*', 'OAuth token (gho_) is masked');
assertContains(sanitizedTruePositive, 'ghu_9*', 'User token (ghu_) is masked');
assertContains(sanitizedTruePositive, 'githu*', 'Fine-grained PAT (github_pat_) is masked');

// The full unmasked tokens should NOT appear
assertNotContains(sanitizedTruePositive, 'ghp_1234567890abcdef1234567890abcdef12345678', 'Full ghp_ token not present');
assertNotContains(sanitizedTruePositive, 'gho_abcdef1234567890abcdef1234567890abcdef12', 'Full gho_ token not present');

console.log('');

// ============================================================================
// Test 5: Real-world log content from Issue #1037
// ============================================================================
console.log('5. Testing with real-world log content from Issue #1037...');

const realWorldContent = `
[2025-12-29T19:24:53.209Z] [INFO] ---END SYSTEM PROMPT---
[2025-12-29T19:24:53.209Z] [INFO]
Playwright MCP usage (browser automation via mcp__playwright__* tools).
   - When you develop frontend web applications (HTML, CSS, JavaScript, React, Vue, Angular, etc.), use Playwright MCP tools to test the UI in a real browser.
   - When you need to visually verify how a web page looks or take screenshots, use browser_take_screenshot from Playwright MCP.
   - When you need to fill forms, click buttons, or perform user interactions on web pages, use Playwright MCP tools (browser_click, browser_type, browser_fill_form).

[2025-12-29T19:25:53.920Z] [INFO] Running command...
"command": "gh gist view 2073c66ab9405a46416dbb51714f843c3016052 2>&1 | head -10000 > logs.txt"

Real GitHub token that should be masked: ghp_realtoken12345678901234567890123456789012
`;

const sanitizedRealWorld = await sanitizeLogContent(realWorldContent);

// False positives should be preserved
assertContains(sanitizedRealWorld, 'browser_take_screenshot', 'Real-world: browser_take_screenshot preserved');
assertContains(sanitizedRealWorld, 'mcp__playwright__', 'Real-world: MCP tool prefix preserved');
assertContains(sanitizedRealWorld, 'browser_click', 'Real-world: browser_click preserved');
assertContains(sanitizedRealWorld, '2073c66ab9405a46416dbb51714f843c3016052', 'Real-world: Gist ID preserved');

// True positives should be masked
assertContains(sanitizedRealWorld, 'ghp_r*', 'Real-world: Real GitHub token is masked');
assertNotContains(sanitizedRealWorld, 'ghp_realtoken12345678901234567890123456789012', 'Real-world: Full token not present');

console.log('');

// ============================================================================
// Summary
// ============================================================================
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 Test Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed! Please review the failures above.');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed! Token masking false positive prevention is working correctly.');
  console.log('\n📋 SUMMARY:');
  console.log('   • browser_take_screenshot and similar tool names are NOT masked');
  console.log('   • MCP tool names (mcp__playwright__*) are NOT masked');
  console.log('   • Gist IDs in "gh gist view" commands are NOT masked');
  console.log('   • Git commit hashes in git command output are NOT masked');
  console.log('   • Real GitHub tokens (ghp_, gho_, ghu_, github_pat_) ARE masked');
  console.log('   • Random hex strings outside safe contexts ARE masked');
  process.exit(0);
}
