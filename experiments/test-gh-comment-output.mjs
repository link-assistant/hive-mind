#!/usr/bin/env node
/**
 * Experiment: Test gh pr comment output format
 *
 * This script tests how `gh pr comment` outputs the comment URL
 * and whether we can reliably extract the comment ID.
 */

import { $ } from 'command-stream';

const OWNER = 'link-foundation';
const REPO = 'test-anywhere';
const PR_NUMBER = 87;

async function testCommentOutput() {
  console.log('Testing gh pr comment output format...\n');

  const testBody = `Test comment to verify output format - ${new Date().toISOString()}`;

  try {
    // Test 1: Standard gh pr comment
    console.log('Test 1: Using gh pr comment');
    console.log(`Command: gh pr comment ${PR_NUMBER} --repo ${OWNER}/${REPO} --body "..."`);

    const result1 = await $`gh pr comment ${PR_NUMBER} --repo ${OWNER}/${REPO} --body ${testBody}`;
    console.log('Result object:', JSON.stringify(result1, null, 2));
    console.log('stdout:', result1.stdout);
    console.log('stderr:', result1.stderr);
    console.log('toString():', result1.toString());

    const output1 = result1.stdout || result1.toString() || '';
    const match1 = output1.match(/issuecomment-(\d+)/);
    console.log('Match result:', match1);
    console.log('Extracted ID:', match1 ? match1[1] : 'NOT FOUND');

    console.log('\n---\n');

    // Test 2: Using gh api directly
    console.log('Test 2: Using gh api directly');
    console.log(`Command: gh api repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments -X POST -f body="..."`);

    const result2 = await $`gh api repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments -X POST -f body=${testBody + ' (API)'}`;
    console.log('stdout:', result2.stdout);

    try {
      const parsed = JSON.parse(result2.stdout);
      console.log('Parsed response - id:', parsed.id);
      console.log('Parsed response - html_url:', parsed.html_url);
    } catch (e) {
      console.log('Failed to parse JSON:', e.message);
    }

    console.log('\n---\n');

    // Test 3: Get last comment to find our comment
    console.log('Test 3: Fetching last comment');
    const result3 = await $`gh api repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments --jq '.[-1] | {id, body}'`;
    console.log('Last comment:', result3.stdout);

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

testCommentOutput();
