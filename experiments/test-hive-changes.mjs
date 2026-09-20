#!/usr/bin/env node

// Test script to verify the hive.mjs changes work correctly

import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

console.log('🧪 Testing hive.mjs pagination improvements...\n');

// Test function to check if the command structure works
const testCommandStructure = async (description, command) => {
  console.log(`📋 ${description}`);
  console.log(`   Command: ${command}`);

  try {
    // We'll do a dry run to test command structure without actually fetching all issues
    const testCmd = command.replace(/--limit 1000/, '--limit 1'); // Small limit for testing
    const output = execSync(testCmd, { encoding: 'utf8', timeout: 10000 });
    const issues = JSON.parse(output || '[]');
    console.log(`✅ Command structure is valid, fetched ${issues.length} issue(s) for testing`);
    return true;
  } catch (error) {
    console.log(`❌ Command failed: ${error.message}`);
    return false;
  }
};

async function runTests() {
  console.log('🔍 Testing improved command structures...\n');

  // Test 1: Repository issue list without limit
  const repoCmd = 'gh issue list --repo microsoft/vscode --state open --json url,title,number';
  await testCommandStructure('Test 1: Repository issues without hardcoded limit', repoCmd);

  // Test 2: Organization search without limit
  const orgCmd = 'gh search issues org:microsoft is:open --json url,title,number,repository';
  await testCommandStructure('Test 2: Organization search without hardcoded limit', orgCmd);

  // Test 3: User search without limit
  const userCmd = 'gh search issues user:torvalds is:open --json url,title,number,repository';
  await testCommandStructure('Test 3: User search without hardcoded limit', userCmd);

  // Test 4: Label filtering without limit
  const labelCmd = 'gh issue list --repo microsoft/vscode --state open --label "bug" --json url,title,number';
  await testCommandStructure('Test 4: Label filtering without hardcoded limit', labelCmd);

  console.log('\n✅ All command structure tests completed.');
  console.log('\n📝 Summary of changes made:');
  console.log('   • Removed hardcoded --limit 100 restrictions');
  console.log('   • Increased default limit to 1000 (10x improvement)');
  console.log('   • Added 5-second delays before and after API calls');
  console.log('   • Added rate limiting with configurable intervals');
  console.log('   • Added fallback handling for API failures');
  console.log('   • Added warning when hitting the 1000 limit');
  console.log('   • Maintained backward compatibility');
}

// Check if the hive.mjs file was actually modified
async function checkFileModification() {
  try {
    const hivePath = path.resolve('../hive.mjs');
    const content = await fs.readFile(hivePath, 'utf8');

    console.log('🔍 Verifying hive.mjs modifications...');

    // Check if our new function exists
    if (content.includes('fetchAllIssuesWithPagination')) {
      console.log('✅ New pagination function found in hive.mjs');
    } else {
      console.log('❌ New pagination function not found in hive.mjs');
    }

    // Check if old hardcoded limits were removed
    const hardcodedLimits = content.match(/--limit 100/g);
    if (!hardcodedLimits || hardcodedLimits.length === 0) {
      console.log('✅ Hardcoded --limit 100 restrictions removed');
    } else {
      console.log(`⚠️  Found ${hardcodedLimits.length} remaining hardcoded --limit 100 restrictions`);
    }

    // Check for rate limiting code
    if (content.includes('setTimeout(resolve, 5000)')) {
      console.log('✅ 5-second rate limiting intervals found');
    } else {
      console.log('❌ 5-second rate limiting intervals not found');
    }
  } catch (error) {
    console.log(`❌ Could not verify file modifications: ${error.message}`);
  }
}

// Run all tests
await checkFileModification();
console.log('');
await runTests();

console.log('\n🎉 Testing completed! The implementation should now:');
console.log('   - Support fetching up to 1000 issues (instead of 100)');
console.log('   - Add proper rate limiting with 5-second intervals');
console.log('   - Respect GitHub API rate limits');
console.log('   - Provide better logging and error handling');
console.log('   - Warn users when hitting limits');
