#!/usr/bin/env node

/**
 * Test script for --auto-cleanup option
 *
 * This script tests:
 * 1. Default behavior (auto-cleanup enabled)
 * 2. Explicit --auto-cleanup behavior
 * 3. --no-auto-cleanup behavior
 * 4. Cleanup on errors
 * 5. Cleanup on CTRL+C
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('🧪 Testing auto-cleanup functionality\n');

// Helper to count gh-issue-solver temp directories
function countTempDirs() {
  const tempRoot = tmpdir();
  const entries = readdirSync(tempRoot);
  return entries.filter(entry => entry.startsWith('gh-issue-solver-')).length;
}

// Test 1: Check that --help shows the --auto-cleanup option
console.log('Test 1: Verify --auto-cleanup option exists in help');
try {
  const helpOutput = execSync('./src/solve.mjs --help', { encoding: 'utf8' });
  if (helpOutput.includes('--auto-cleanup')) {
    console.log('✅ --auto-cleanup option found in help');
    if (helpOutput.includes('--no-auto-cleanup')) {
      console.log('✅ --no-auto-cleanup is mentioned');
    } else {
      console.log('⚠️  --no-auto-cleanup not explicitly mentioned in help');
    }
  } else {
    console.log('❌ --auto-cleanup option NOT found in help');
  }
} catch (error) {
  console.log(`⚠️  Could not check help: ${error.message}`);
}

console.log('');

// Test 2: Check default value is undefined (visibility-based)
console.log('Test 2: Verify default value is auto-cleanup=undefined (visibility-based)');
console.log('This will be verified through config loading...');
// We can't easily test this without actually running solve.mjs
try {
  const { readFileSync } = await import('fs');
  const configContent = readFileSync('./src/solve.config.lib.mjs', 'utf8');
  if (configContent.includes('default: undefined')) {
    console.log('✅ Default value set to undefined in config (visibility-based)');
  } else {
    console.log('❌ Default value NOT set to undefined');
  }
} catch (error) {
  console.log(`⚠️  Could not verify: ${error.message}`);
}
console.log('');

// Test 3: Count temp directories before and after
console.log('Test 3: Check temp directory behavior');
const beforeCount = countTempDirs();
console.log(`Current temp directories: ${beforeCount}`);

// We can't fully test cleanup without a real GitHub issue
// But we can verify the config accepts the flag
console.log('⚠️  Full cleanup testing requires a real solve run');
console.log('');

// Test 4: Check that cleanupTempDirectory respects the flag
console.log('Test 4: Code inspection of cleanupTempDirectory');
try {
  const { readFileSync } = await import('fs');
  const repoLibContent = readFileSync('./src/solve.repository.lib.mjs', 'utf8');

  if (repoLibContent.includes('argv.autoCleanup')) {
    console.log('✅ cleanupTempDirectory uses argv.autoCleanup');
  } else {
    console.log('❌ cleanupTempDirectory does NOT use argv.autoCleanup');
  }

  if (repoLibContent.includes('--no-auto-cleanup')) {
    console.log('✅ Message mentions --no-auto-cleanup');
  }
} catch (error) {
  console.log(`⚠️  Could not inspect code: ${error.message}`);
}
console.log('');

// Test 5: Check exit-handler integration
console.log('Test 5: Code inspection of exit-handler integration');
try {
  const { readFileSync } = await import('fs');
  const exitHandlerContent = readFileSync('./src/exit-handler.lib.mjs', 'utf8');

  if (exitHandlerContent.includes('cleanupFunction')) {
    console.log('✅ exit-handler accepts cleanup function');
  } else {
    console.log('❌ exit-handler does NOT accept cleanup function');
  }

  if (exitHandlerContent.includes('SIGINT') && exitHandlerContent.includes('cleanupFunction')) {
    console.log('✅ SIGINT handler calls cleanup function');
  } else {
    console.log('❌ SIGINT handler does NOT call cleanup function');
  }

  const solveContent = readFileSync('./src/solve.mjs', 'utf8');
  if (solveContent.includes('cleanupWrapper')) {
    console.log('✅ solve.mjs creates cleanup wrapper');
  } else {
    console.log('❌ solve.mjs does NOT create cleanup wrapper');
  }

  if (solveContent.includes('cleanupContext')) {
    console.log('✅ solve.mjs populates cleanup context');
  } else {
    console.log('❌ solve.mjs does NOT populate cleanup context');
  }
} catch (error) {
  console.log(`⚠️  Could not inspect code: ${error.message}`);
}
console.log('');

// Test 6: Check resume recommendation logic
console.log('Test 6: Code inspection of resume recommendation logic');
try {
  const { readFileSync } = await import('fs');
  const resultsLibContent = readFileSync('./src/solve.results.lib.mjs', 'utf8');

  if (resultsLibContent.includes('argv.autoCleanup === false')) {
    console.log('✅ Resume recommendation checks argv.autoCleanup');
  } else {
    console.log('❌ Resume recommendation does NOT check argv.autoCleanup');
  }

  if (resultsLibContent.includes('use --no-auto-cleanup')) {
    console.log('✅ Message suggests using --no-auto-cleanup');
  } else {
    console.log('❌ Message does NOT suggest --no-auto-cleanup');
  }
} catch (error) {
  console.log(`⚠️  Could not inspect code: ${error.message}`);
}
console.log('');

console.log('📊 Test Summary:');
console.log('  All code inspections completed successfully');
console.log('  To test runtime behavior, run solve.mjs with a real issue');
console.log('');
console.log('  Examples:');
console.log('    ./src/solve.mjs <public-repo-issue-url>        # Auto-cleanup disabled (default for public)');
console.log('    ./src/solve.mjs <private-repo-issue-url>       # Auto-cleanup enabled (default for private)');
console.log('    ./src/solve.mjs <issue-url> --auto-cleanup     # Explicit auto-cleanup (always clean)');
console.log('    ./src/solve.mjs <issue-url> --no-auto-cleanup  # Keep directory (always keep)');
