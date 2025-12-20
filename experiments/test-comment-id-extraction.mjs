#!/usr/bin/env node
/**
 * Test comment ID extraction from gh pr comment output
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Test the output format of gh pr comment
async function testCommentOutput() {
  console.log('Testing gh pr comment output format...\n');

  // Post a test comment to PR 852 and capture output
  const testComment = '## Test comment for ID extraction\n\nThis is a test comment to understand the output format of `gh pr comment`.\n\n_Will be deleted shortly._';

  try {
    // Test with execSync
    console.log('=== Using execSync ===');
    const resultSync = execSync(`gh pr comment 852 --repo link-assistant/hive-mind --body "${testComment.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
    console.log('Result type:', typeof resultSync);
    console.log('Result value:', resultSync);

    // Try to extract comment ID
    const matchSync = resultSync.match(/issuecomment-(\d+)/);
    console.log('Regex match:', matchSync);
    console.log('Comment ID:', matchSync ? matchSync[1] : 'NOT FOUND');

    // If we found the comment ID, delete the test comment
    if (matchSync && matchSync[1]) {
      console.log('\n=== Deleting test comment ===');
      execSync(`gh api repos/link-assistant/hive-mind/issues/comments/${matchSync[1]} -X DELETE`);
      console.log('Deleted successfully');
    }

    // Now test with execAsync (more similar to command-stream behavior)
    console.log('\n\n=== Using execAsync ===');
    const testComment2 = '## Test comment 2 for async\n\nSecond test.\n\n_Will be deleted shortly._';
    const { stdout, stderr } = await execAsync(`gh pr comment 852 --repo link-assistant/hive-mind --body "${testComment2.replace(/"/g, '\\"')}"`);
    console.log('stdout type:', typeof stdout);
    console.log('stdout value:', stdout);
    console.log('stderr type:', typeof stderr);
    console.log('stderr value:', stderr);

    const matchAsync = stdout.match(/issuecomment-(\d+)/);
    console.log('Regex match:', matchAsync);
    console.log('Comment ID:', matchAsync ? matchAsync[1] : 'NOT FOUND');

    if (matchAsync && matchAsync[1]) {
      console.log('\n=== Deleting test comment 2 ===');
      execSync(`gh api repos/link-assistant/hive-mind/issues/comments/${matchAsync[1]} -X DELETE`);
      console.log('Deleted successfully');
    }

  } catch (error) {
    console.error('Error:', error);
    console.error('Error stdout:', error.stdout);
    console.error('Error stderr:', error.stderr);
  }
}

testCommentOutput();
