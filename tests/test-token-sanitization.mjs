#!/usr/bin/env node

/**
 * Unit tests for token sanitization functions (Issue #1037)
 *
 * Tests the token masking logic to ensure:
 * 1. Real GitHub tokens (ghp_, gho_, ghu_, github_pat_) ARE masked
 * 2. Legitimate identifiers (browser_take_screenshot, MCP tools) are NOT masked
 * 3. Git commit hashes in safe contexts are NOT masked
 * 4. Gist IDs in gh gist commands are NOT masked
 * 5. 40-char hex strings outside safe contexts ARE masked
 */

// Import the functions we need to test
import { isSafeToken, isHexInSafeContext, sanitizeLogContent } from '../src/token-sanitization.lib.mjs';
import { maskToken } from '../src/lib.mjs';

// Test framework
let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

async function runAsyncTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertContains(str, substring, message = '') {
  if (!str.includes(substring)) {
    throw new Error(`${message}\nExpected string to contain: "${substring}"\nActual string: "${str.substring(0, 200)}..."`);
  }
}

function assertNotContains(str, substring, message = '') {
  if (str.includes(substring)) {
    throw new Error(`${message}\nExpected string NOT to contain: "${substring}"\nActual string: "${str.substring(0, 200)}..."`);
  }
}

console.log('🧪 Running token sanitization unit tests (Issue #1037)...\n');
console.log('='.repeat(80));

// ==== isSafeToken function tests ====
console.log('\n📋 Test Group 1: isSafeToken function - Safe patterns\n');

runTest('browser_take_screenshot is safe', () => {
  assertEqual(isSafeToken('browser_take_screenshot'), true, 'browser_ tools should be safe');
});

runTest('browser_click is safe', () => {
  assertEqual(isSafeToken('browser_click'), true, 'browser_ tools should be safe');
});

runTest('browser_snapshot is safe', () => {
  assertEqual(isSafeToken('browser_snapshot'), true, 'browser_ tools should be safe');
});

runTest('browser_navigate is safe', () => {
  assertEqual(isSafeToken('browser_navigate'), true, 'browser_ tools should be safe');
});

runTest('browser_fill_form is safe', () => {
  assertEqual(isSafeToken('browser_fill_form'), true, 'browser_ tools should be safe');
});

runTest('mcp__playwright__browser_snapshot is safe', () => {
  assertEqual(isSafeToken('mcp__playwright__browser_snapshot'), true, 'MCP tools should be safe');
});

runTest('mcp__playwright__browser_click is safe', () => {
  assertEqual(isSafeToken('mcp__playwright__browser_click'), true, 'MCP tools should be safe');
});

runTest('mcp__filesystem__read_file is safe', () => {
  assertEqual(isSafeToken('mcp__filesystem__read_file'), true, 'MCP tools should be safe');
});

runTest('get_user_profile is safe', () => {
  assertEqual(isSafeToken('get_user_profile'), true, 'Functions with underscores should be safe');
});

runTest('validate_user_input is safe', () => {
  assertEqual(isSafeToken('validate_user_input'), true, 'Functions with underscores should be safe');
});

runTest('process_batch_request is safe', () => {
  assertEqual(isSafeToken('process_batch_request'), true, 'Functions with underscores should be safe');
});

runTest('UUID is safe', () => {
  assertEqual(isSafeToken('183fd583-b795-4920-8be5-be778aff7fa9'), true, 'UUIDs should be safe');
});

runTest('another UUID format is safe', () => {
  assertEqual(isSafeToken('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), true, 'UUIDs should be safe');
});

console.log('\n📋 Test Group 2: isSafeToken function - Unsafe patterns\n');

runTest('GitHub PAT is NOT safe', () => {
  assertEqual(isSafeToken('ghp_1234567890abcdef1234567890abcdef12345678'), false, 'GitHub PAT should not be safe');
});

runTest('Random hex string is NOT safe', () => {
  assertEqual(isSafeToken('1234567890abcdef1234567890abcdef12345678'), false, 'Random hex should not be safe');
});

runTest('Short random string is NOT safe', () => {
  assertEqual(isSafeToken('abcdef123456'), false, 'Short random string should not be safe');
});

runTest('Empty string is NOT safe', () => {
  assertEqual(isSafeToken(''), false, 'Empty string should not be safe');
});

runTest('null is NOT safe', () => {
  assertEqual(isSafeToken(null), false, 'null should not be safe');
});

runTest('undefined is NOT safe', () => {
  assertEqual(isSafeToken(undefined), false, 'undefined should not be safe');
});

// ==== isHexInSafeContext function tests ====
console.log('\n📋 Test Group 3: isHexInSafeContext function - Safe contexts\n');

const testHex40 = '2073c66ab9405a46416dbb51714f843c3016052a';

runTest('gh gist view context is safe', () => {
  const context = `Running: gh gist view ${testHex40} --raw`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), true, 'gh gist view context should be safe');
});

runTest('git log context is safe', () => {
  const context = `Running: git log ${testHex40}`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), true, 'git log context should be safe');
});

runTest('git show context is safe', () => {
  const context = `git show ${testHex40} --stat`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), true, 'git show context should be safe');
});

runTest('git diff context is safe', () => {
  const context = `git diff ${testHex40}`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), true, 'git diff context should be safe');
});

runTest('git cherry-pick context is safe', () => {
  const context = `git cherry-pick ${testHex40}`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), true, 'git cherry-pick context should be safe');
});

runTest('commit SHA in git log output is safe', () => {
  const context = `commit ${testHex40}\nAuthor: Test User`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), true, 'commit SHA in output should be safe');
});

runTest('SHA: prefix context is safe', () => {
  const context = `SHA: ${testHex40}`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), true, 'SHA: prefix should be safe');
});

console.log('\n📋 Test Group 4: isHexInSafeContext function - Unsafe contexts\n');

runTest('oauth_token context is NOT safe', () => {
  const context = `oauth_token: ${testHex40}`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), false, 'oauth_token context should not be safe');
});

runTest('API token context is NOT safe', () => {
  const context = `API response: {"token": "${testHex40}"}`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), false, 'API token context should not be safe');
});

runTest('random context is NOT safe', () => {
  const context = `Some random text ${testHex40} more text`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), false, 'Random context should not be safe');
});

runTest('authorization header context is NOT safe', () => {
  const context = `Authorization: Bearer ${testHex40}`;
  assertEqual(isHexInSafeContext(context, testHex40, context.indexOf(testHex40)), false, 'Authorization header should not be safe');
});

// ==== maskToken function tests ====
console.log('\n📋 Test Group 5: maskToken function\n');

runTest('maskToken masks long token correctly', () => {
  const token = 'ghp_1234567890abcdef1234567890abcdef12345678';
  const masked = maskToken(token);
  assertContains(masked, 'ghp_1', 'Should preserve prefix');
  assertContains(masked, '*', 'Should contain asterisks');
  assertContains(masked, '5678', 'Should preserve suffix');
});

runTest('maskToken returns short tokens unchanged', () => {
  const token = 'short';
  const masked = maskToken(token);
  // maskToken doesn't mask tokens shorter than minLength (default 12)
  // This is intentional - very short strings are unlikely to be sensitive tokens
  assertEqual(masked, token, 'Short tokens should be returned unchanged');
});

// ==== sanitizeLogContent function tests - False Positives Prevention ====
console.log('\n📋 Test Group 6: sanitizeLogContent - False positives prevention\n');

await runAsyncTest('browser_take_screenshot is NOT masked', async () => {
  const content = 'When you need screenshots, use browser_take_screenshot from Playwright MCP.';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'browser_take_screenshot', 'Should preserve browser_take_screenshot');
});

await runAsyncTest('mcp__playwright__browser_click is NOT masked', async () => {
  const content = 'Use mcp__playwright__browser_click for clicking elements.';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'mcp__playwright__browser_click', 'Should preserve MCP tool name');
});

await runAsyncTest('Long function names are NOT masked', async () => {
  const content = 'Function: validate_user_input_and_sanitize_data';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'validate_user_input_and_sanitize_data', 'Should preserve long function names');
});

await runAsyncTest('Gist ID in gh gist view is NOT masked', async () => {
  const content = `Running: gh gist view ${testHex40} --raw`;
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, testHex40, 'Should preserve gist ID in gh gist view context');
});

await runAsyncTest('Commit SHA in git log output is NOT masked', async () => {
  const content = `commit ${testHex40}\nAuthor: Test User <test@example.com>`;
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, testHex40, 'Should preserve commit SHA in git log output');
});

await runAsyncTest('Multiple Playwright tools in same log are NOT masked', async () => {
  const content = `
    - browser_take_screenshot for screenshots
    - browser_click for clicking
    - browser_type for typing
    - browser_navigate for navigation
    - mcp__playwright__browser_snapshot for accessibility
  `;
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'browser_take_screenshot', 'Should preserve browser_take_screenshot');
  assertContains(sanitized, 'browser_click', 'Should preserve browser_click');
  assertContains(sanitized, 'browser_type', 'Should preserve browser_type');
  assertContains(sanitized, 'browser_navigate', 'Should preserve browser_navigate');
  assertContains(sanitized, 'mcp__playwright__browser_snapshot', 'Should preserve mcp__playwright__browser_snapshot');
});

await runAsyncTest('No partial masking of browser tools', async () => {
  const content = 'Use browser_take_screenshot for screenshots.';
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, 'brows*', 'Should not have partial masking of browser tool');
  assertNotContains(sanitized, '*nshot', 'Should not have partial masking of browser tool');
});

// ==== sanitizeLogContent function tests - True Positives ====
console.log('\n📋 Test Group 7: sanitizeLogContent - True positives (should mask)\n');

await runAsyncTest('GitHub PAT (ghp_) IS masked', async () => {
  const token = 'ghp_1234567890abcdef1234567890abcdef12345678';
  const content = `Token: ${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask GitHub PAT');
  assertContains(sanitized, 'ghp_1', 'Should preserve prefix in mask');
  assertContains(sanitized, '*', 'Should contain asterisks');
});

await runAsyncTest('OAuth token (gho_) IS masked', async () => {
  const token = 'gho_abcdef1234567890abcdef1234567890abcdef12';
  const content = `oauth_token: ${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask OAuth token');
  assertContains(sanitized, 'gho_a', 'Should preserve prefix in mask');
});

await runAsyncTest('User token (ghu_) IS masked', async () => {
  const token = 'ghu_9876543210fedcba9876543210fedcba98765432';
  const content = `User token: ${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask user token');
  assertContains(sanitized, 'ghu_9', 'Should preserve prefix in mask');
});

await runAsyncTest('Fine-grained PAT (github_pat_) IS masked', async () => {
  const token = 'github_pat_abcdefghijklmnopqrstuvwxyz1234567890';
  const content = `Fine-grained PAT: ${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask fine-grained PAT');
  assertContains(sanitized, '*', 'Should contain asterisks');
});

await runAsyncTest('Multiple tokens in same log ARE masked', async () => {
  const token1 = 'ghp_aaaabbbbccccddddeeeeffffgggghhhhiiii';
  const token2 = 'gho_11112222333344445555666677778888aaaa';
  const content = `Token1: ${token1}\nToken2: ${token2}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token1, 'Should mask first token');
  assertNotContains(sanitized, token2, 'Should mask second token');
});

// ==== Real-world scenario tests ====
console.log('\n📋 Test Group 8: Real-world scenarios from Issue #1037\n');

await runAsyncTest('Real-world log with mixed content', async () => {
  const content = `
[2025-12-29T19:24:53.209Z] [INFO] ---END SYSTEM PROMPT---
[2025-12-29T19:24:53.209Z] [INFO]
Playwright MCP usage (browser automation via mcp__playwright__* tools).
   - When you develop frontend web applications (HTML, CSS, JavaScript, React, Vue, Angular, etc.), use Playwright MCP tools to test the UI in a real browser.
   - When you need to visually verify how a web page looks or take screenshots, use browser_take_screenshot from Playwright MCP.
   - When you need to fill forms, click buttons, or perform user interactions on web pages, use Playwright MCP tools (browser_click, browser_type, browser_fill_form).

[2025-12-29T19:25:53.920Z] [INFO] Running command...
"command": "gh gist view 2073c66ab9405a46416dbb51714f843c3016052a 2>&1 | head -10000 > logs.txt"

Real GitHub token that should be masked: ghp_realtoken12345678901234567890123456789012
`;
  const sanitized = await sanitizeLogContent(content);

  // False positives should NOT be masked
  assertContains(sanitized, 'browser_take_screenshot', 'Should preserve browser_take_screenshot');
  assertContains(sanitized, 'mcp__playwright__', 'Should preserve mcp__playwright__ prefix');
  assertContains(sanitized, 'browser_click', 'Should preserve browser_click');
  assertContains(sanitized, 'browser_type', 'Should preserve browser_type');
  assertContains(sanitized, 'browser_fill_form', 'Should preserve browser_fill_form');
  assertContains(sanitized, '2073c66ab9405a46416dbb51714f843c3016052a', 'Should preserve gist ID');

  // True positives SHOULD be masked
  assertNotContains(sanitized, 'ghp_realtoken12345678901234567890123456789012', 'Should mask GitHub token');
  assertContains(sanitized, 'ghp_r*', 'Should show masked prefix');
});

await runAsyncTest('Git operations with commit hashes', async () => {
  const content = `
git log 1234567890abcdef1234567890abcdef12345678
commit 1234567890abcdef1234567890abcdef12345678
Author: Test User <test@example.com>
Date:   Mon Dec 30 2025

git diff 1234567890abcdef1234567890abcdef12345678
git show 1234567890abcdef1234567890abcdef12345678 --stat
git cherry-pick 1234567890abcdef1234567890abcdef12345678
`;
  const sanitized = await sanitizeLogContent(content);
  // Git commit hashes in safe contexts should NOT be masked
  assertContains(sanitized, '1234567890abcdef1234567890abcdef12345678', 'Should preserve git commit hashes');
});

await runAsyncTest('Edge case: underscore-heavy identifiers', async () => {
  const content = `
Function names to preserve:
- process_user_data_batch_async
- validate_input_string_format
- convert_json_to_xml_safely
- handle_api_request_error
`;
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'process_user_data_batch_async', 'Should preserve underscore-heavy function names');
  assertContains(sanitized, 'validate_input_string_format', 'Should preserve underscore-heavy function names');
  assertContains(sanitized, 'convert_json_to_xml_safely', 'Should preserve underscore-heavy function names');
  assertContains(sanitized, 'handle_api_request_error', 'Should preserve underscore-heavy function names');
});

// ==== Additional edge case tests ====
console.log('\n📋 Test Group 9: Edge cases and boundary conditions\n');

await runAsyncTest('Empty content returns empty', async () => {
  const sanitized = await sanitizeLogContent('');
  assertEqual(sanitized, '', 'Empty content should return empty');
});

await runAsyncTest('Content with no tokens remains unchanged', async () => {
  const content = 'Hello, this is a simple log message with no tokens.';
  const sanitized = await sanitizeLogContent(content);
  assertEqual(sanitized, content, 'Content without tokens should remain unchanged');
});

await runAsyncTest('Mixed case tokens are handled', async () => {
  const content = 'Token: GHP_AbCdEf123456789012345678901234567890';
  const sanitized = await sanitizeLogContent(content);
  // GitHub token prefixes are case-sensitive (ghp_, not GHP_)
  // But the token pattern should still match for security
  assertContains(sanitized, 'GHP_AbCdEf123456789012345678901234567890', 'Mixed case non-standard prefix should be preserved');
});

await runAsyncTest('Token at very beginning of content', async () => {
  const token = 'ghp_starttoken1234567890123456789012345678';
  const content = `${token} at the start`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask token at beginning');
});

await runAsyncTest('Token at very end of content', async () => {
  const token = 'ghp_endtoken12345678901234567890123456789012';
  const content = `at the end: ${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask token at end');
});

await runAsyncTest('Special characters around tokens', async () => {
  const token = 'ghp_specialchars12345678901234567890123456';
  const content = `[${token}] and (${token}) and "${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask tokens surrounded by special characters');
});

await runAsyncTest('Very long content with multiple tool references', async () => {
  let content = '';
  for (let i = 0; i < 100; i++) {
    content += `browser_take_screenshot_${i} mcp__playwright__tool_${i}\n`;
  }
  const sanitized = await sanitizeLogContent(content);
  // Should not mask any of these tool references
  assertContains(sanitized, 'browser_take_screenshot_0', 'Should preserve first tool reference');
  assertContains(sanitized, 'browser_take_screenshot_99', 'Should preserve last tool reference');
  assertNotContains(sanitized, '*', 'Should not contain any asterisks (no masking)');
});

// Summary
console.log('\n' + '='.repeat(80));
console.log(`Test Results for Token Sanitization (Issue #1037):`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(80));

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed! Please review the failures above.');
  console.log('\n📋 ISSUE #1037 SUMMARY:');
  console.log('   The token sanitization must:');
  console.log('   • NOT mask browser_take_screenshot and similar tool names');
  console.log('   • NOT mask MCP tool names (mcp__playwright__*)');
  console.log('   • NOT mask git commit hashes in git command contexts');
  console.log('   • NOT mask gist IDs in gh gist commands');
  console.log('   • MUST mask real GitHub tokens (ghp_, gho_, ghu_, github_pat_)');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed! Token sanitization is working correctly.');
  console.log('\n📋 VERIFIED BEHAVIORS:');
  console.log('   ✓ browser_take_screenshot and similar tool names are NOT masked');
  console.log('   ✓ MCP tool names (mcp__playwright__*) are NOT masked');
  console.log('   ✓ Git commit hashes in git command contexts are NOT masked');
  console.log('   ✓ Gist IDs in "gh gist view" commands are NOT masked');
  console.log('   ✓ Real GitHub tokens (ghp_, gho_, ghu_, github_pat_) ARE masked');
  console.log('   ✓ Random hex strings outside safe contexts ARE masked');
  process.exit(0);
}
