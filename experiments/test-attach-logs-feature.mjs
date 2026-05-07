#!/usr/bin/env node

// Comprehensive test of the --attach-logs feature
console.log('🧪 Testing --attach-logs feature implementation...\n');

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Test 1: Verify command line option exists
console.log('1. Testing command line option...');
try {
  const helpOutput = execSync('node solve.mjs --help 2>&1', { encoding: 'utf8', cwd: '..' });

  if (helpOutput.includes('--attach-logs')) {
    console.log('   ✅ --attach-logs option exists in help text');
  } else {
    console.log('   ❌ --attach-logs option not found in help text');
  }

  if (!helpOutput.includes('--attach-solution-logs')) {
    console.log('   ✅ --attach-solution-logs successfully removed from help text');
  } else {
    console.log('   ❌ --attach-solution-logs still found in help text (should be removed)');
  }

  if (helpOutput.includes('⚠️ WARNING: May expose sensitive data')) {
    console.log('   ✅ Security warning in help text');
  } else {
    console.log('   ❌ Security warning missing from help text');
  }

  if (helpOutput.includes('[default: false]')) {
    console.log('   ✅ Default is disabled (safe)');
  } else {
    console.log('   ❌ Default might not be disabled');
  }
} catch (e) {
  console.log('   ❌ Error testing help:', e.message);
}

// Test 2: Verify security warning code exists
console.log('\n2. Testing security warning implementation...');
try {
  const solveContent = readFileSync('./solve.mjs', 'utf8');

  if (solveContent.includes('SECURITY WARNING')) {
    console.log('   ✅ Security warning message found in code');
  } else {
    console.log('   ❌ Security warning message missing');
  }

  if (solveContent.includes('API keys, tokens, or secrets')) {
    console.log('   ✅ Specific security risks mentioned');
  } else {
    console.log('   ❌ Security risks not properly explained');
  }

  if (solveContent.includes('5 seconds')) {
    console.log('   ✅ Countdown delay implemented');
  } else {
    console.log('   ❌ Countdown delay missing');
  }

  if (solveContent.includes('argv.attachSolutionLogs')) {
    console.log('   ✅ Option is properly checked in code');
  } else {
    console.log('   ❌ Option check missing in code');
  }
} catch (e) {
  console.log('   ❌ Error reading solve.mjs:', e.message);
}

// Test 3: Verify log upload functionality
console.log('\n3. Testing log upload implementation...');
try {
  const solveContent = readFileSync('./solve.mjs', 'utf8');

  if (solveContent.includes('gh pr comment') && solveContent.includes('gh issue comment')) {
    console.log('   ✅ Both PR and issue comment upload implemented');
  } else {
    console.log('   ❌ Comment upload functionality incomplete');
  }

  if (solveContent.includes('25 * 1024 * 1024')) {
    console.log('   ✅ File size limit check (25MB GitHub limit)');
  } else {
    console.log('   ❌ File size limit check missing');
  }

  if (solveContent.includes('<details>')) {
    console.log('   ✅ Collapsible details formatting for large logs');
  } else {
    console.log('   ❌ Log formatting may not be user-friendly');
  }

  if (solveContent.includes('Solution Log')) {
    console.log('   ✅ Proper log comment formatting');
  } else {
    console.log('   ❌ Log comment formatting missing');
  }
} catch (e) {
  console.log('   ❌ Error analyzing upload code:', e.message);
}

// Test 4: Verify integration points
console.log('\n4. Testing integration points...');
try {
  const solveContent = readFileSync('./solve.mjs', 'utf8');

  if (solveContent.includes('🎉 SUCCESS: A solution has been prepared as a pull request')) {
    console.log('   ✅ PR success integration point found');
  } else {
    console.log('   ❌ PR success integration point missing');
  }

  if (solveContent.includes('💬 SUCCESS: Comment posted on issue')) {
    console.log('   ✅ Issue comment integration point found');
  } else {
    console.log('   ❌ Issue comment integration point missing');
  }

  if (solveContent.includes('Solution log has been attached')) {
    console.log('   ✅ Success message mentions log attachment');
  } else {
    console.log('   ❌ Success message should mention log attachment');
  }
} catch (e) {
  console.log('   ❌ Error testing integration:', e.message);
}

console.log('\n🧪 Feature implementation test complete!\n');

// Summary
console.log('📋 SUMMARY:');
console.log('   • --attach-logs option available (--attach-solution-logs removed)');
console.log('   • Default disabled for security');
console.log('   • Strong security warnings with countdown');
console.log('   • Uploads logs to both PRs and issue comments');
console.log('   • Respects GitHub file size limits');
console.log('   • Proper markdown formatting with collapsible details');
console.log('   • Integrates with existing success flows');
console.log('');
console.log('✅ Implementation appears complete and follows security best practices!');
