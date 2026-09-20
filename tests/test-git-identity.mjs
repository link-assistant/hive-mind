#!/usr/bin/env node

/**
 * Test suite for git identity validation functions
 * Tests git.lib.mjs checkGitIdentity function
 *
 * Issue: https://github.com/link-assistant/hive-mind/issues/1131
 * This test validates the fix for "fatal: empty ident name" errors
 */

import { checkGitIdentity, repairGitIdentity } from '../src/git.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  return Promise.resolve()
    .then(() => testFn())
    .then(() => {
      console.log('\u2705 PASSED');
      testsPassed++;
    })
    .catch(error => {
      console.log(`\u274C FAILED: ${error.message}`);
      testsFailed++;
    });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

console.log('\u{1F9EA} Git Identity Validation Tests\n');

// Create mock exec function for testing different scenarios
const createMockExec = (nameValue, emailValue, showOriginValue = null) => {
  return async (cmd, _options) => {
    // Handle 'git config user.name'
    if (cmd === 'git config user.name') {
      if (nameValue === null) {
        throw new Error('exit code 1');
      }
      return { stdout: nameValue };
    }
    // Handle 'git config user.email'
    if (cmd === 'git config user.email') {
      if (emailValue === null) {
        throw new Error('exit code 1');
      }
      return { stdout: emailValue };
    }
    // Handle 'git config --show-origin user.name'
    if (cmd === 'git config --show-origin user.name') {
      if (showOriginValue === null) {
        throw new Error('exit code 1');
      }
      return { stdout: showOriginValue };
    }
    throw new Error(`Unexpected command: ${cmd}`);
  };
};

// Test: Valid configuration with both name and email
await runTest('checkGitIdentity - valid configuration', async () => {
  const mockExec = createMockExec('Test User', 'test@example.com', 'file:/home/user/.gitconfig\tTest User');

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === true, 'Should be valid');
  assertEqual(result.name, 'Test User', 'Name should match');
  assertEqual(result.email, 'test@example.com', 'Email should match');
  assertEqual(result.scope, 'global', 'Scope should be global');
  assertEqual(result.error, null, 'Should have no error');
});

// Test: Missing name
await runTest('checkGitIdentity - missing name', async () => {
  const mockExec = createMockExec(null, 'test@example.com');

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === false, 'Should be invalid');
  assertEqual(result.name, null, 'Name should be null');
  assertEqual(result.email, 'test@example.com', 'Email should be present');
  assert(result.error.includes('user.name'), 'Error should mention user.name');
});

// Test: Missing email
await runTest('checkGitIdentity - missing email', async () => {
  const mockExec = createMockExec('Test User', null);

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === false, 'Should be invalid');
  assertEqual(result.name, 'Test User', 'Name should be present');
  assertEqual(result.email, null, 'Email should be null');
  assert(result.error.includes('user.email'), 'Error should mention user.email');
});

// Test: Both missing
await runTest('checkGitIdentity - both missing', async () => {
  const mockExec = createMockExec(null, null);

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === false, 'Should be invalid');
  assertEqual(result.name, null, 'Name should be null');
  assertEqual(result.email, null, 'Email should be null');
  assert(result.error.includes('user.name'), 'Error should mention user.name');
  assert(result.error.includes('user.email'), 'Error should mention user.email');
  assertEqual(result.scope, 'none', 'Scope should be none');
});

// Test: Empty string name (git rejects this too)
await runTest('checkGitIdentity - empty string name', async () => {
  const mockExec = createMockExec('', 'test@example.com');

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === false, 'Should be invalid for empty name');
  assert(result.error.includes('user.name'), 'Error should mention user.name');
});

// Test: Empty string email
await runTest('checkGitIdentity - empty string email', async () => {
  const mockExec = createMockExec('Test User', '');

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === false, 'Should be invalid for empty email');
  assert(result.error.includes('user.email'), 'Error should mention user.email');
});

// Test: Local scope detection
await runTest('checkGitIdentity - local scope detection', async () => {
  const mockExec = createMockExec('Test User', 'test@example.com', 'file:/path/to/repo/.git/config\tTest User');

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === true, 'Should be valid');
  assertEqual(result.scope, 'local', 'Scope should be local');
});

// Test: System scope detection
await runTest('checkGitIdentity - system scope detection', async () => {
  const mockExec = createMockExec('Test User', 'test@example.com', 'file:/etc/gitconfig\tTest User');

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === true, 'Should be valid');
  assertEqual(result.scope, 'global', 'System config should report as global');
});

// Test: Whitespace-only name (should be invalid)
await runTest('checkGitIdentity - whitespace-only name', async () => {
  const mockExec = createMockExec('   ', 'test@example.com');

  const result = await checkGitIdentity(mockExec);

  // Note: This depends on trim() behavior - "   ".trim() = ""
  // Empty string after trim should be invalid
  assert(result.name === null || result.name === '', 'Whitespace-only should be empty or null after trim');
});

// Test: Names and emails with newlines get trimmed
await runTest('checkGitIdentity - trims newlines', async () => {
  const mockExec = createMockExec('Test User\n', 'test@example.com\n', 'file:/home/user/.gitconfig\tTest User\n');

  const result = await checkGitIdentity(mockExec);

  assert(result.isValid === true, 'Should be valid');
  assertEqual(result.name, 'Test User', 'Name should be trimmed');
  assertEqual(result.email, 'test@example.com', 'Email should be trimmed');
});

// Test: Actual system integration (if git is available)
await runTest('checkGitIdentity - real git (integration)', async () => {
  // This test runs against the actual git config
  const result = await checkGitIdentity();

  // We can't guarantee what the actual config is, but the function should not throw
  assert(typeof result.isValid === 'boolean', 'Should return boolean isValid');
  assert(result.name === null || typeof result.name === 'string', 'Name should be null or string');
  assert(result.email === null || typeof result.email === 'string', 'Email should be null or string');
  assert(['global', 'local', 'none'].includes(result.scope), 'Scope should be valid');

  console.log(`  [INFO] Current git config: name="${result.name}", email="${result.email}", scope=${result.scope}`);
});

console.log('\n\u{1F527} repairGitIdentity Tests\n');

// Create mock exec function for repair testing
const createRepairMockExec = (whichSuccess, repairSuccess, identityAfterRepair) => {
  let repairCalled = false;
  return async (cmd, _options) => {
    // Handle 'which gh-setup-git-identity'
    if (cmd === 'which gh-setup-git-identity') {
      if (!whichSuccess) {
        throw new Error('command not found: gh-setup-git-identity');
      }
      return { stdout: '/usr/local/bin/gh-setup-git-identity' };
    }
    // Handle 'gh-setup-git-identity --repair'
    if (cmd === 'gh-setup-git-identity --repair') {
      repairCalled = true;
      if (!repairSuccess) {
        throw new Error('repair failed');
      }
      return { stdout: 'Git identity configured successfully', stderr: '' };
    }
    // Handle git config checks after repair
    if (cmd === 'git config user.name') {
      if (repairCalled && identityAfterRepair) {
        return { stdout: identityAfterRepair.name || '' };
      }
      throw new Error('exit code 1');
    }
    if (cmd === 'git config user.email') {
      if (repairCalled && identityAfterRepair) {
        return { stdout: identityAfterRepair.email || '' };
      }
      throw new Error('exit code 1');
    }
    if (cmd === 'git config --show-origin user.name') {
      if (repairCalled && identityAfterRepair) {
        return { stdout: `file:/home/user/.gitconfig\t${identityAfterRepair.name}` };
      }
      throw new Error('exit code 1');
    }
    throw new Error(`Unexpected command: ${cmd}`);
  };
};

// Test: repairGitIdentity - gh-setup-git-identity not installed
await runTest('repairGitIdentity - tool not installed', async () => {
  const mockExec = createRepairMockExec(false, false, null);

  const result = await repairGitIdentity(mockExec);

  assert(result.success === false, 'Should fail');
  assert(result.error.includes('not installed'), 'Error should mention not installed');
});

// Test: repairGitIdentity - successful repair
await runTest('repairGitIdentity - successful repair', async () => {
  const mockExec = createRepairMockExec(true, true, { name: 'Repaired User', email: 'repaired@example.com' });

  const result = await repairGitIdentity(mockExec);

  assert(result.success === true, 'Should succeed');
  assertEqual(result.error, null, 'Should have no error');
});

// Test: repairGitIdentity - repair command fails
await runTest('repairGitIdentity - repair command fails', async () => {
  const mockExec = createRepairMockExec(true, false, null);

  const result = await repairGitIdentity(mockExec);

  assert(result.success === false, 'Should fail');
  assert(result.error.includes('Failed to repair'), 'Error should mention failure');
});

// Test: repairGitIdentity - repair completes but identity still invalid
await runTest('repairGitIdentity - repair completes but identity still invalid', async () => {
  // Tool is installed, repair "succeeds" but identity is still not configured
  const mockExec = createRepairMockExec(true, true, null);

  const result = await repairGitIdentity(mockExec);

  assert(result.success === false, 'Should fail');
  assert(result.error.includes('still invalid'), 'Error should mention identity still invalid');
});

// Print summary
console.log('\n' + '-'.repeat(50));
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log('-'.repeat(50));

if (testsFailed > 0) {
  console.log('\n\u274C Some tests failed');
  process.exit(1);
} else {
  console.log('\n\u2705 All tests passed');
  process.exit(0);
}
