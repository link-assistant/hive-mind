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

// ==== AI Provider Token Tests (OpenAI, Anthropic, Google, etc.) ====
// Note: Test tokens are constructed dynamically to avoid triggering GitHub secret scanning
// These are NOT real API tokens - they are synthetic patterns that match the regex
console.log('\n📋 Test Group 10: AI Provider tokens - OpenAI\n');

// Helper to create synthetic tokens that match patterns but aren't real secrets
// OpenAI signature: T3BlbkFJ (base64 of "OpenAI")
const openAISignature = Buffer.from('OpenAI').toString('base64');

await runAsyncTest('OpenAI project API key (sk-proj-) IS masked', async () => {
  // Construct test token dynamically to avoid secret scanning
  const token = ['sk-proj-', 'abcdefghijklmnopqrst', openAISignature, 'uvwxyz1234567890abcd'].join('');
  const content = `OPENAI_API_KEY=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask OpenAI project API key');
  assertContains(sanitized, 'sk-pr', 'Should preserve prefix in mask');
  assertContains(sanitized, '*', 'Should contain asterisks');
});

await runAsyncTest('OpenAI service account key (sk-svcacct-) IS masked', async () => {
  const token = ['sk-svcacct-', 'abcdefghijklmnopq', openAISignature, 'rstuvwxyz123456789'].join('');
  const content = `export OPENAI_API_KEY="${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask OpenAI service account key');
});

await runAsyncTest('OpenAI admin key (sk-admin-) IS masked', async () => {
  const token = ['sk-admin-', 'abcdefghijklmnopqrs', openAISignature, 'tuvwxyz12345678901'].join('');
  const content = `apiKey: ${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask OpenAI admin key');
});

await runAsyncTest('OpenAI legacy key (sk-) IS masked', async () => {
  const token = ['sk-', 'abcdefghijklmnopqrstuvwx', openAISignature, 'yz12345678901234567'].join('');
  const content = `api_key = "${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask OpenAI legacy key');
});

console.log('\n📋 Test Group 11: AI Provider tokens - Anthropic (Claude)\n');

await runAsyncTest('Anthropic API key (sk-ant-api03-) IS masked', async () => {
  const token = ['sk-ant-api03-', 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ'].join('');
  const content = `ANTHROPIC_API_KEY=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Anthropic API key');
  assertContains(sanitized, 'sk-an', 'Should preserve prefix in mask');
  assertContains(sanitized, '*', 'Should contain asterisks');
});

await runAsyncTest('Anthropic API key with different version (sk-ant-api01-) IS masked', async () => {
  const token = ['sk-ant-api01-', 'xyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh'].join('');
  const content = `anthropic_key: "${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Anthropic API key v1');
});

await runAsyncTest('Anthropic API key short format (sk-ant-) IS masked', async () => {
  const token = ['sk-ant-', 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG'].join('');
  const content = `export CLAUDE_API_KEY=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Anthropic short format key');
});

console.log('\n📋 Test Group 12: AI Provider tokens - Google (Gemini)\n');

await runAsyncTest('Google API / Gemini key (AIza*) IS masked', async () => {
  const token = ['AIzaSyB', 'abcdefghijklmnopqrstuvwxyz12345'].join('');
  const content = `GOOGLE_API_KEY="${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Google API key');
  assertContains(sanitized, 'AIzaS', 'Should preserve prefix in mask');
  assertContains(sanitized, '*', 'Should contain asterisks');
});

await runAsyncTest('Google Gemini API key IS masked', async () => {
  const token = ['AIzaSyC', '1234567890abcdefghijklmnopqrstu'].join('');
  const content = `gemini_api_key: ${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Google Gemini key');
});

console.log('\n📋 Test Group 13: AI Provider tokens - HuggingFace\n');

await runAsyncTest('HuggingFace API token (hf_*) IS masked', async () => {
  // Construct dynamically to avoid secret scanning
  const token = ['hf_', 'abcdefghijklmnopqrstuvwxyzABCDEFGH'].join('');
  const content = `HUGGINGFACE_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask HuggingFace token');
  assertContains(sanitized, 'hf_ab', 'Should preserve prefix in mask');
  assertContains(sanitized, '*', 'Should contain asterisks');
});

await runAsyncTest('HuggingFace token in Python code IS masked', async () => {
  const token = ['hf_', 'xyzABCDEFGHIJKLMNOPQRSTUVWXYZ01234'].join('');
  const content = `huggingface_hub.login("${token}")`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask HuggingFace token in code');
});

console.log('\n📋 Test Group 14: Other sensitive tokens (AWS, Slack, Stripe, etc.)\n');

await runAsyncTest('AWS Access Key ID (AKIA*) IS masked', async () => {
  const token = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  const content = `aws_access_key_id = ${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask AWS Access Key ID');
  assertContains(sanitized, 'AKIAI', 'Should preserve prefix in mask');
});

await runAsyncTest('AWS Session Token (ASIA*) IS masked', async () => {
  const token = ['ASIA', 'XYZABCDEFGHIJKLM'].join('');
  const content = `AWS_ACCESS_KEY_ID="${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask AWS Session Token');
});

await runAsyncTest('Slack bot token (xoxb-*) IS masked', async () => {
  const token = ['xoxb', '-', '123456789012', '-', '1234567890123', '-', 'abcdefghijklmnopqrstuvwx'].join('');
  const content = `SLACK_BOT_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Slack bot token');
});

await runAsyncTest('Slack user token (xoxp-*) IS masked', async () => {
  const token = ['xoxp', '-', '123456789', '-', '123456789', '-', '123456789', '-', 'abcdefghijklmnopqrstuv'].join('');
  const content = `slack_token: "${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Slack user token');
});

await runAsyncTest('Stripe live secret key (sk_live_*) IS masked', async () => {
  const token = ['sk', '_live_', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
  const content = `STRIPE_SECRET_KEY=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Stripe live secret key');
});

await runAsyncTest('Stripe test secret key (sk_test_*) IS masked', async () => {
  const token = ['sk', '_test_', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
  const content = `stripe_key: "${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Stripe test secret key');
});

await runAsyncTest('Stripe publishable key (pk_live_*) IS masked', async () => {
  const token = ['pk', '_live_', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
  const content = `publishableKey: "${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Stripe publishable key');
});

await runAsyncTest('SendGrid API key IS masked', async () => {
  const token = ['SG', '.', 'abcdefghijklmnopqrstuv', '.', 'abcdefghijklmnopqrstuvwxyz1234567890ABCDE'].join('');
  const content = `SENDGRID_API_KEY=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask SendGrid API key');
});

await runAsyncTest('Twilio API key (SK*) IS masked', async () => {
  const token = ['S', 'K', '1234567890abcdef1234567890abcdef'].join('');
  const content = `TWILIO_API_KEY=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Twilio API key');
});

await runAsyncTest('Mailchimp API key IS masked', async () => {
  const token = ['1234567890abcdef1234567890abcdef', '-', 'us10'].join('');
  const content = `MAILCHIMP_API_KEY=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Mailchimp API key');
});

await runAsyncTest('Square access token (sq0atp-*) IS masked', async () => {
  const token = ['sq0', 'atp', '-', 'abcdefghijklmnopqrstuvwxyz'].join('');
  const content = `SQUARE_ACCESS_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Square access token');
});

await runAsyncTest('Shopify access token (shpat_*) IS masked', async () => {
  const token = ['shp', 'at', '_', '1234567890abcdef1234567890abcdef'].join('');
  const content = `SHOPIFY_ACCESS_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Shopify access token');
});

await runAsyncTest('Databricks token (dapi*) IS masked', async () => {
  const token = ['d', 'api', '1234567890abcdef1234567890abcdef'].join('');
  const content = `DATABRICKS_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Databricks token');
});

await runAsyncTest('npm token (npm_*) IS masked', async () => {
  const token = ['n', 'pm', '_', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
  const content = `NPM_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask npm token');
});

await runAsyncTest('PyPI token (pypi-*) IS masked', async () => {
  const token = ['py', 'pi-', 'AgEIcHlwaS5vcmcCJDEyMzQ1Njc4LTEyMzQtMTIzNC0xMjM0LTEyMzQ1Njc4OTAxMgACJXsicG'].join('');
  const content = `PYPI_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask PyPI token');
});

await runAsyncTest('Discord bot token IS masked', async () => {
  const token = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', '.', 'G12345', '.', 'abcdefghijklmnopqrstuvwxyzAB'].join('');
  const content = `DISCORD_BOT_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Discord bot token');
});

await runAsyncTest('Telegram bot token IS masked', async () => {
  const token = ['123456789', ':', 'ABCdefGHIjklMNOpqrSTUvwxYZ1234567890'].join('');
  const content = `TELEGRAM_BOT_TOKEN=${token}`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask Telegram bot token');
});

console.log('\n📋 Test Group 15: False positives - AI/provider prefixes that should NOT be masked\n');

await runAsyncTest('Short sk- prefix alone is NOT masked', async () => {
  const content = 'The prefix sk- indicates a secret key';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'sk-', 'Short sk- prefix should not be masked');
});

await runAsyncTest('Documentation about hf_ token format is NOT masked', async () => {
  const content = 'HuggingFace tokens start with hf_ prefix and contain alphanumeric chars';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'hf_', 'hf_ in documentation should not be masked');
});

await runAsyncTest('AWS key documentation is NOT masked', async () => {
  const content = 'AWS Access Keys start with AKIA prefix';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'AKIA', 'AKIA in documentation should not be masked');
});

await runAsyncTest('Google AIza prefix in docs is NOT masked', async () => {
  const content = 'Google API keys start with AIza prefix';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'AIza', 'AIza in documentation should not be masked');
});

console.log('\n📋 Test Group 16: Real-world mixed content with multiple AI provider tokens\n');

await runAsyncTest('Mixed AI provider tokens in environment config', async () => {
  const openaiToken = ['sk-proj-', 'abcdefghijklmnopqrst', openAISignature, 'uvwxyz1234567890abcd'].join('');
  const anthropicToken = ['sk-ant-api03-', 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ'].join('');
  const geminiToken = ['AIzaSyB', 'abcdefghijklmnopqrstuvwxyz12345'].join('');
  const huggingfaceToken = ['hf_', 'abcdefghijklmnopqrstuvwxyzABCDEFGH'].join('');

  const content = `
# Environment configuration
OPENAI_API_KEY="${openaiToken}"
ANTHROPIC_API_KEY="${anthropicToken}"
GOOGLE_API_KEY="${geminiToken}"
HUGGINGFACE_TOKEN="${huggingfaceToken}"

# These should NOT be masked
browser_take_screenshot mcp__playwright__browser_click
commit 2073c66ab9405a46416dbb51714f843c3016052a
`;
  const sanitized = await sanitizeLogContent(content);

  // All tokens should be masked
  assertNotContains(sanitized, openaiToken, 'Should mask OpenAI token');
  assertNotContains(sanitized, anthropicToken, 'Should mask Anthropic token');
  assertNotContains(sanitized, geminiToken, 'Should mask Google/Gemini token');
  assertNotContains(sanitized, huggingfaceToken, 'Should mask HuggingFace token');

  // These should NOT be masked (false positives)
  assertContains(sanitized, 'browser_take_screenshot', 'Should preserve browser tool name');
  assertContains(sanitized, 'mcp__playwright__browser_click', 'Should preserve MCP tool name');
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

// ==== Secretlint integration tests with realistic token formats ====
console.log('\n📋 Test Group 17: Secretlint integration - realistic token formats\n');

// Realistic OpenAI token: sk-{20 chars}T3BlbkFJ{20 chars} = 51 chars total
await runAsyncTest('Realistic OpenAI legacy token IS masked', async () => {
  const padding20 = 'abcdefghij1234567890';
  const token = `sk-${padding20}T3BlbkFJ${padding20}`;
  const content = `OPENAI_API_KEY="${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask realistic OpenAI token');
  assertContains(sanitized, '*', 'Should contain asterisks');
});

// Realistic Anthropic token: sk-ant-api03-{93 chars}AA = 108 chars total
await runAsyncTest('Realistic Anthropic token IS masked', async () => {
  const body = 'A'.repeat(93);
  const token = `sk-ant-api03-${body}AA`;
  const content = `ANTHROPIC_API_KEY="${token}"`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, token, 'Should mask realistic Anthropic token');
});

// Test private key detection (via secretlint)
await runAsyncTest('Private key IS masked', async () => {
  const content = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3US2zzMpVb0H7vSjJVVNxF4TvVYvhR3w2vLZM4lEv4ZFCa
0C7LNpf8vbT8vR7lOvvR6WvY3eZljS2xB5qL5rVlVQxvR8VN3vEuBLVhPvVvVnJH
-----END RSA PRIVATE KEY-----
`;
  const sanitized = await sanitizeLogContent(content);
  // Private keys should have some masking applied
  assertNotContains(sanitized, 'MIIEowIBAAKCAQEA0Z3US2zzMpVb0H7vSjJVVNxF4TvVYvhR3w2vLZM4lEv4ZFCa', 'Should mask private key content');
});

// Test basicauth URL (via secretlint)
await runAsyncTest('Basic auth URL IS masked', async () => {
  const content = 'postgresql://user:supersecretpassword@localhost:5432/mydb';
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, 'supersecretpassword', 'Should mask password in URL');
});

console.log('\n📋 Test Group 18: Additional false positive prevention\n');

await runAsyncTest('Common programming terms are NOT masked', async () => {
  const content = `
    const sk_test = 'short variable';
    let hf_config = {};
    var AKIA_PREFIX = 'constant';
  `;
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'sk_test', 'Should preserve sk_test variable name');
  assertContains(sanitized, 'hf_config', 'Should preserve hf_config variable name');
  assertContains(sanitized, 'AKIA_PREFIX', 'Should preserve AKIA_PREFIX constant name');
});

await runAsyncTest('Short sk-ant prefix is NOT masked', async () => {
  const content = 'Use sk-ant prefix for Anthropic tokens';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'sk-ant', 'Should preserve short sk-ant prefix in documentation');
});

await runAsyncTest('GitHub Actions workflow names are NOT masked', async () => {
  const content = 'Run npm_install_step and then npm_test_step workflows';
  const sanitized = await sanitizeLogContent(content);
  assertContains(sanitized, 'npm_install_step', 'Should preserve workflow step name');
  assertContains(sanitized, 'npm_test_step', 'Should preserve workflow step name');
});

console.log('\n📋 Test Group 19: Edge cases for multi-line content\n');

await runAsyncTest('Multi-line environment file IS sanitized', async () => {
  const ghpToken = 'ghp_1234567890abcdef1234567890abcdef12345678';
  const content = `
# Development environment
NODE_ENV=development
DEBUG=true

# API Keys (SENSITIVE)
GITHUB_TOKEN=${ghpToken}
DATABASE_URL=localhost

# Safe content
browser_take_screenshot
mcp__playwright__browser_click
`;
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, ghpToken, 'Should mask GitHub token');
  assertContains(sanitized, 'browser_take_screenshot', 'Should preserve safe content');
  assertContains(sanitized, 'mcp__playwright__browser_click', 'Should preserve MCP tool name');
});

await runAsyncTest('JSON config with tokens IS sanitized', async () => {
  const slackToken = ['xoxb', '-', '123456789012', '-', '1234567890123', '-', 'abcdefghijklmnopqrstuvwx'].join('');
  const content = JSON.stringify({
    slack: { token: slackToken },
    tools: ['browser_take_screenshot', 'mcp__playwright__browser_click'],
    git: { commit: '2073c66ab9405a46416dbb51714f843c3016052a' },
  });
  const sanitized = await sanitizeLogContent(content);
  assertNotContains(sanitized, slackToken, 'Should mask Slack token in JSON');
  assertContains(sanitized, 'browser_take_screenshot', 'Should preserve tool name in JSON');
});

console.log('\n📋 Test Group 20: Linear tokens (via secretlint)\n');

await runAsyncTest('Linear API token IS masked', async () => {
  // Linear API keys are 39 chars starting with lin_api_
  const token = 'lin_api_abcdefghij1234567890abcdefghij123';
  const content = `LINEAR_API_KEY=${token}`;
  const sanitized = await sanitizeLogContent(content);
  // This should be masked by secretlint's linear rule
  assertNotContains(sanitized, 'lin_api_abcdefghij1234567890abcdefghij123', 'Should mask Linear API key');
});

// Note: 1Password tokens are validated by secretlint to be actual JWT tokens
// with valid JSON payload, so synthetic test tokens won't match.
// Real 1Password tokens will be detected by secretlint in production.

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
