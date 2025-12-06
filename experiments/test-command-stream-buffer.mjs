#!/usr/bin/env node
/**
 * Experiment: Test command-stream Buffer handling
 *
 * This script tests how command-stream returns stdout
 * and whether the Buffer-to-string conversion works correctly.
 */

import { $ } from 'command-stream';

const OWNER = 'link-assistant';
const REPO = 'hive-mind';
const PR_NUMBER = 846;

async function testCommandStreamBuffer() {
  console.log('Testing command-stream Buffer handling...\n');

  const testBody = `🔬 Command-stream test - ${new Date().toISOString()}`;

  try {
    // Test gh pr comment and examine the result
    console.log('Running: gh pr comment...');
    const result = await $`gh pr comment ${PR_NUMBER} --repo ${OWNER}/${REPO} --body ${testBody}`;

    console.log('\n=== Result Object Analysis ===');
    console.log('Type of result:', typeof result);
    console.log('result keys:', Object.keys(result));

    console.log('\n=== stdout Analysis ===');
    console.log('Type of result.stdout:', typeof result.stdout);
    console.log('result.stdout is Buffer:', Buffer.isBuffer(result.stdout));
    console.log('result.stdout raw:', result.stdout);
    console.log('result.stdout?.toString():', result.stdout?.toString());

    console.log('\n=== result.toString() Analysis ===');
    console.log('Type of result.toString():', typeof result.toString());
    console.log('result.toString():', result.toString());

    console.log('\n=== Regex Matching ===');
    // Original buggy pattern:
    const buggyOutput = result.stdout || result.toString() || '';
    console.log('Buggy pattern output type:', typeof buggyOutput);
    console.log('Buggy pattern output:', buggyOutput);
    console.log('Buggy pattern is Buffer:', Buffer.isBuffer(buggyOutput));

    const buggyMatch = (typeof buggyOutput === 'string' ? buggyOutput : '').match(/issuecomment-(\d+)/);
    console.log('Buggy pattern match:', buggyMatch);

    // Fixed pattern:
    const fixedOutput = result.stdout?.toString() || result.toString() || '';
    console.log('\nFixed pattern output type:', typeof fixedOutput);
    console.log('Fixed pattern output:', fixedOutput);

    const fixedMatch = fixedOutput.match(/issuecomment-(\d+)/);
    console.log('Fixed pattern match:', fixedMatch);
    console.log('Extracted comment ID:', fixedMatch ? fixedMatch[1] : 'NOT FOUND');

    // Additional test: What if we use String() instead?
    const stringOutput = String(result.stdout || '');
    console.log('\nString() conversion output:', stringOutput);
    const stringMatch = stringOutput.match(/issuecomment-(\d+)/);
    console.log('String() pattern match:', stringMatch);

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

testCommandStreamBuffer();
