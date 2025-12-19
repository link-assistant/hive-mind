#!/usr/bin/env node
/**
 * Test script to verify the timestamp fix for issue #678
 *
 * This simulates the scenario where:
 * 1. First run creates CLAUDE.md with task info
 * 2. Second run appends the same task info (without timestamp = no changes)
 * 3. Third run appends the same task info (with timestamp = unique changes)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testScenario(name, appendFunction) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));

  const testDir = path.join(__dirname, `test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  const claudeMdPath = path.join(testDir, 'CLAUDE.md');

  // Simulate task info (same for all runs)
  const taskInfo = `Issue to solve: https://github.com/test/repo/issues/1
Your prepared branch: issue-1-abc123
Your prepared working directory: /tmp/test

Proceed.`;

  try {
    // First run: Create file
    console.log('\n1. First run: Creating CLAUDE.md');
    await fs.writeFile(claudeMdPath, taskInfo);
    const content1 = await fs.readFile(claudeMdPath, 'utf8');
    console.log(`   File size: ${content1.length} bytes`);

    // Second run: Append (simulating auto-continue)
    console.log('\n2. Second run: Appending to CLAUDE.md');
    const existingContent = await fs.readFile(claudeMdPath, 'utf8');
    const newContent = appendFunction(existingContent, taskInfo);
    await fs.writeFile(claudeMdPath, newContent);
    const content2 = await fs.readFile(claudeMdPath, 'utf8');
    console.log(`   File size: ${content2.length} bytes`);
    console.log(`   Size change: ${content2.length - content1.length} bytes`);

    // Third run: Append again (another retry)
    console.log('\n3. Third run: Appending again to CLAUDE.md');
    const existingContent2 = await fs.readFile(claudeMdPath, 'utf8');
    const newContent2 = appendFunction(existingContent2, taskInfo);
    await fs.writeFile(claudeMdPath, newContent2);
    const content3 = await fs.readFile(claudeMdPath, 'utf8');
    console.log(`   File size: ${content3.length} bytes`);
    console.log(`   Size change: ${content3.length - content2.length} bytes`);

    // Analysis
    console.log('\n4. Analysis:');
    if (content2.length === content1.length) {
      console.log('   ❌ PROBLEM: Second run produced no changes (would cause PR creation failure)');
    } else {
      console.log('   ✅ SUCCESS: Second run produced changes');
    }

    if (content3.length === content2.length) {
      console.log('   ❌ PROBLEM: Third run produced no changes (would cause PR creation failure)');
    } else {
      console.log('   ✅ SUCCESS: Third run produced changes');
    }

    // Show final content preview
    console.log('\n5. Final content preview:');
    const lines = content3.split('\n');
    console.log(`   Total lines: ${lines.length}`);
    console.log(`   Last 5 lines:\n${lines.slice(-5).map(l => `     ${l}`).join('\n')}`);

  } finally {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// OLD BEHAVIOR: Append without timestamp (problematic)
function appendWithoutTimestamp(existingContent, taskInfo) {
  const trimmedExisting = existingContent.trimEnd();
  return `${trimmedExisting}\n\n---\n\n${taskInfo}`;
}

// NEW BEHAVIOR: Append with timestamp (fixed)
function appendWithTimestamp(existingContent, taskInfo) {
  const trimmedExisting = existingContent.trimEnd();
  const timestamp = new Date().toISOString();
  return `${trimmedExisting}\n\n---\n\n${taskInfo}\n\nRun timestamp: ${timestamp}`;
}

// Run tests
(async () => {
  console.log('TESTING FIX FOR ISSUE #678: PR Creation Failure');

  await testScenario('OLD BEHAVIOR (without timestamp)', appendWithoutTimestamp);

  // Wait a bit to ensure different timestamps
  await new Promise(resolve => setTimeout(resolve, 100));

  await testScenario('NEW BEHAVIOR (with timestamp)', appendWithTimestamp);

  console.log('\n' + '='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));
  console.log('\nConclusion:');
  console.log('  The timestamp fix ensures each run creates unique content,');
  console.log('  preventing "No commits between branches" errors when using');
  console.log('  --auto-continue with existing branches.');
  console.log('');
})();
