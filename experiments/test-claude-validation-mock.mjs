#!/usr/bin/env node

// Mock test for Claude validation function to test error handling logic

const log = async (message, options = {}) => {
  const { level = 'info' } = options;
  switch (level) {
    case 'error':
      console.error(message);
      break;
    case 'warning':
      console.warn(message);
      break;
    default:
      console.log(message);
  }
};

const cleanErrorMessage = error => {
  let message = error.message || error.toString();
  message = message.split('\n')[0];
  return message;
};

// Mock test function that simulates different claude command responses
const testClaudeValidation = async mockResult => {
  try {
    await log(`🔍 Testing with mock result...`);

    const stdout = mockResult.stdout || '';
    const stderr = mockResult.stderr || '';
    const code = mockResult.code || 0;

    // Check for JSON errors in stdout or stderr
    const checkForJsonError = text => {
      try {
        if (text.includes('"error"') && text.includes('"type"')) {
          const jsonMatch = text.match(/\{.*"error".*\}/);
          if (jsonMatch) {
            const errorObj = JSON.parse(jsonMatch[0]);
            return errorObj.error;
          }
        }
      } catch (e) {
        // Not valid JSON, continue with other checks
      }
      return null;
    };

    const jsonError = checkForJsonError(stdout) || checkForJsonError(stderr);

    if (code !== 0) {
      // Command failed
      if (jsonError) {
        await log(`❌ Claude CLI authentication failed: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
      } else {
        await log(`❌ Claude CLI failed with exit code ${code}`, { level: 'error' });
        if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
      }

      if (stderr.includes('Please run /login') || (jsonError && jsonError.type === 'forbidden')) {
        await log('   💡 Please run: claude login', { level: 'error' });
      }

      return false;
    }

    // Check for error patterns in successful response
    if (jsonError) {
      await log(`❌ Claude CLI returned error: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
      if (jsonError.type === 'forbidden') {
        await log('   💡 Please run: claude login', { level: 'error' });
      }
      return false;
    }

    // Success - Claude responded
    await log(`✅ Claude CLI connection validated successfully`);
    return true;
  } catch (error) {
    await log(`❌ Failed to validate Claude CLI connection: ${cleanErrorMessage(error)}`, { level: 'error' });
    return false;
  }
};

console.log('Testing Claude validation with different mock responses...\n');

// Test 1: Success case
console.log('=== Test 1: Success case ===');
let result1 = await testClaudeValidation({
  code: 0,
  stdout: 'Hello! How can I help you with your project today?',
  stderr: '',
});
console.log(`Result: ${result1 ? 'PASS' : 'FAIL'}\n`);

// Test 2: 403 JSON error case (from issue example)
console.log('=== Test 2: 403 JSON error case ===');
let result2 = await testClaudeValidation({
  code: 1,
  stdout: 'API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}} · Please run /login',
  stderr: '',
});
console.log(`Result: ${result2 ? 'FAIL (should be false)' : 'PASS'}\n`);

// Test 3: Non-zero exit code without JSON
console.log('=== Test 3: Generic error case ===');
let result3 = await testClaudeValidation({
  code: 1,
  stdout: '',
  stderr: 'claude: command not found',
});
console.log(`Result: ${result3 ? 'FAIL (should be false)' : 'PASS'}\n`);

// Test 4: JSON error in successful response (edge case)
console.log('=== Test 4: JSON error in successful response ===');
let result4 = await testClaudeValidation({
  code: 0,
  stdout: '{"error":{"type":"rate_limit","message":"Too many requests"}}',
  stderr: '',
});
console.log(`Result: ${result4 ? 'FAIL (should be false)' : 'PASS'}\n`);

console.log('All tests completed!');
