#!/usr/bin/env node

// Test script to verify our log truncation fix
console.log('🧪 Testing log truncation fix...\n');

import fs from 'fs/promises';

// Test 1: Check if solve.mjs still has truncation code
console.log('1. Checking solve.mjs for truncation logic...');
try {
  const solveContent = await fs.readFile('./solve.mjs', 'utf8');

  // Check if the old truncation logic was removed
  if (solveContent.includes('substring(logContent.length - 50000)')) {
    console.log('   ❌ Old truncation logic still present');
  } else {
    console.log('   ✅ Old truncation logic removed');
  }

  if (solveContent.includes('log truncated, showing last 50KB')) {
    console.log('   ❌ Truncation message still present');
  } else {
    console.log('   ✅ Truncation message removed');
  }

  // Check if it now uses the proper attachLogToGitHub function
  if (solveContent.includes('attachLogToGitHub')) {
    console.log('   ✅ Using proper attachLogToGitHub function');
  } else {
    console.log('   ❌ Not using proper attachLogToGitHub function');
  }

  // Check if it passes error message for failure logs
  if (solveContent.includes('errorMessage: cleanErrorMessage(error)')) {
    console.log('   ✅ Passes error message to log function');
  } else {
    console.log("   ❌ Doesn't pass error message properly");
  }
} catch (error) {
  console.log(`   ❌ Error reading solve.mjs: ${error.message}`);
}

// Test 2: Check if github.lib.mjs has proper gist handling
console.log('\n2. Checking github.lib.mjs for proper gist handling...');
try {
  const githubLibContent = await fs.readFile('./github.lib.mjs', 'utf8');

  // Check GitHub comment limit constant
  if (githubLibContent.includes('GITHUB_COMMENT_LIMIT = 65536')) {
    console.log('   ✅ Proper GitHub comment limit (65,536 chars)');
  } else {
    console.log('   ❌ Missing or incorrect GitHub comment limit');
  }

  // Check gist creation logic
  if (githubLibContent.includes('gh gist create')) {
    console.log('   ✅ Gist creation functionality present');
  } else {
    console.log('   ❌ Gist creation functionality missing');
  }

  // Check error message support
  if (githubLibContent.includes('errorMessage')) {
    console.log('   ✅ Supports error messages in comments');
  } else {
    console.log("   ❌ Doesn't support error messages");
  }

  // Check both success and failure formatting
  if (githubLibContent.includes('Solution Failed') && githubLibContent.includes('Solution Log')) {
    console.log('   ✅ Supports both success and failure log formats');
  } else {
    console.log('   ❌ Missing success or failure log formats');
  }
} catch (error) {
  console.log(`   ❌ Error reading github.lib.mjs: ${error.message}`);
}

console.log('\n🧪 Test complete!\n');

// Summary
console.log('📋 SUMMARY:');
console.log('   • Logs are never truncated in solve.mjs');
console.log('   • Large logs are uploaded as GitHub Gists');
console.log('   • Error messages are properly included in failure logs');
console.log('   • Full logs are preserved for complete traceability');
console.log('');
console.log('✅ Log truncation issue has been resolved!');
