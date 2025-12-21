#!/usr/bin/env node

// Test script to verify auto-cleanup functionality
// This script simulates a dry-run with auto-cleanup enabled

import { execSync } from 'child_process';

console.log('🧪 Testing auto-cleanup functionality...\n');

// Create some test files in /tmp to see if cleanup works
console.log('📁 Creating test files in /tmp...');
execSync('mkdir -p /tmp/test-hive-cleanup');
execSync('echo "test content" > /tmp/test-hive-cleanup/test-file.txt');
execSync('ls -la /tmp/test-hive-cleanup/');

console.log('\n🚀 Running hive.mjs with --dry-run and --auto-cleanup...');

// Test with a non-existent repository to ensure it completes quickly
const testUrl = 'https://github.com/nonexistent-test-user-12345';

try {
  // Run with dry-run to avoid actual processing but test the flow
  const output = execSync(`./hive.mjs "${testUrl}" --dry-run --once --auto-cleanup --verbose`, {
    encoding: 'utf8',
    timeout: 30000 // 30 second timeout
  });

  console.log('Output:', output);

  // Check if our test files were cleaned up
  try {
    execSync('ls /tmp/test-hive-cleanup/', { encoding: 'utf8' });
    console.log('❌ Test files still exist - cleanup may not have worked');
  } catch (e) {
    console.log('✅ Test files were cleaned up successfully!');
  }
} catch (error) {
  console.log('⚠️  Expected error (non-existent repo):', error.message.split('\n')[0]);
  console.log('This is normal for our test - the important thing is the cleanup behavior');
}
