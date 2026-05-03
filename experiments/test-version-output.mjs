#!/usr/bin/env node

/**
 * Test script to verify version output functionality
 * Requirement: Always include version of solve or ./solve.mjs in the beginning of the log
 */

import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const solvePath = join(__dirname, '..', 'src', 'solve.mjs');

console.log('Testing version output functionality...\n');

// Test 1: Check --version flag outputs only version
console.log('Test 1: --version flag output');
console.log('='.repeat(50));
try {
  const versionOutput = execSync(`${solvePath} --version`, { encoding: 'utf8' }).trim();
  console.log(`Version output: "${versionOutput}"`);

  // Check format - should be either x.y.z or x.y.z.commitSha
  const versionRegex = /^\d+\.\d+\.\d+(\.[a-f0-9]{7,8})?$/;
  if (versionRegex.test(versionOutput)) {
    console.log('✅ Version format is correct');
  } else {
    console.log(`❌ Version format is incorrect. Expected x.y.z or x.y.z.commitSha, got: ${versionOutput}`);
  }

  // Make sure nothing else is output
  const lines = versionOutput.split('\n');
  if (lines.length === 1) {
    console.log('✅ Only version is output (no extra text)');
  } else {
    console.log(`❌ Extra lines in output: ${lines.length} lines found`);
  }
} catch (error) {
  console.log(`❌ Error running --version: ${error.message}`);
}

console.log('\n');

// Test 2: Check version is logged at the beginning when running normally
console.log('Test 2: Version logging at startup');
console.log('='.repeat(50));
try {
  // Run with a fake URL to trigger early exit but still see initial logs
  const output = execSync(`${solvePath} invalid-url 2>&1`, { encoding: 'utf8' });
  console.log('First few lines of output:');
  const lines = output.split('\n').slice(0, 10);
  lines.forEach((line, i) => console.log(`  ${i + 1}: ${line}`));

  // Check if version is logged early
  const versionLineRegex = /solve v\d+\.\d+\.\d+/;
  const hasVersionLog = lines.some(line => versionLineRegex.test(line));

  if (hasVersionLog) {
    console.log('✅ Version is logged at the beginning');
    const versionLine = lines.find(line => versionLineRegex.test(line));
    console.log(`   Found: "${versionLine}"`);
  } else {
    console.log('❌ Version not found in initial output');
  }
} catch (error) {
  // Expected to fail with invalid URL, but we should still see the version in stderr/stdout
  const output = error.stdout || error.stderr || '';
  console.log('First few lines of output (from error):');
  const lines = output.split('\n').slice(0, 10);
  lines.forEach((line, i) => console.log(`  ${i + 1}: ${line}`));

  const versionLineRegex = /solve v\d+\.\d+\.\d+/;
  const hasVersionLog = lines.some(line => versionLineRegex.test(line));

  if (hasVersionLog) {
    console.log('✅ Version is logged at the beginning');
    const versionLine = lines.find(line => versionLineRegex.test(line));
    console.log(`   Found: "${versionLine}"`);
  } else {
    console.log('❌ Version not found in initial output');
  }
}

console.log('\n');

// Test 3: Check if dev version format works (when not on a tag)
console.log('Test 3: Development version format');
console.log('='.repeat(50));
try {
  // Get current git state
  const currentTag = execSync('git describe --exact-match --tags HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
  console.log(`Currently on tag: ${currentTag}`);
  console.log('ℹ️  Version should be from package.json (release version)');
} catch {
  console.log('Not on a tagged commit');
  console.log('ℹ️  Version should be in format: latestTag.commitSha');

  try {
    const latestTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim().replace(/^v/, '');
    const commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    console.log(`   Expected format: ${latestTag}.${commitSha}`);

    // Check actual output
    const versionOutput = execSync(`${solvePath} --version`, { encoding: 'utf8' }).trim();
    if (versionOutput === `${latestTag}.${commitSha}`) {
      console.log(`✅ Dev version format is correct: ${versionOutput}`);
    } else {
      console.log(`⚠️  Version output: ${versionOutput}`);
      console.log(`   Expected: ${latestTag}.${commitSha}`);
    }
  } catch (error) {
    console.log(`Error checking git state: ${error.message}`);
  }
}

console.log('\n');
console.log('='.repeat(50));
console.log('Version output testing complete!');
