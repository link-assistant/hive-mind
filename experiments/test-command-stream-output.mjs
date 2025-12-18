#!/usr/bin/env node
/**
 * Test command-stream output format for gh pr comment
 *
 * This directly imports command-stream to test how it handles gh pr comment output.
 */

// Use npx to run command-stream directly
import { execSync } from 'child_process';

// First, check how the raw gh command output looks
console.log('=== Testing raw gh output format ===');
try {
  const testComment = 'Test comment - will be deleted';
  const rawResult = execSync(`gh pr comment 852 --repo link-assistant/hive-mind --body "${testComment}"`, { encoding: 'utf8' });
  console.log('Raw output:', JSON.stringify(rawResult));
  console.log('Raw output length:', rawResult.length);

  const match = rawResult.match(/issuecomment-(\d+)/);
  console.log('Match result:', match);

  if (match && match[1]) {
    console.log('Comment ID found:', match[1]);
    execSync(`gh api repos/link-assistant/hive-mind/issues/comments/${match[1]} -X DELETE`);
    console.log('Comment deleted');
  }
} catch (e) {
  console.error('Error in raw test:', e.message);
}

// Now test with dynamic import of command-stream
console.log('\n\n=== Testing command-stream import ===');
try {
  const commandStream = await import('command-stream');
  console.log('command-stream exports:', Object.keys(commandStream));

  const { $ } = commandStream;
  console.log('$ type:', typeof $);

  const testComment2 = 'Test comment 2 - command-stream test';
  const result = await $`gh pr comment 852 --repo link-assistant/hive-mind --body ${testComment2}`;

  console.log('\n=== Result object analysis ===');
  console.log('typeof result:', typeof result);
  console.log('result keys:', Object.keys(result));
  console.log('result.stdout:', result.stdout);
  console.log('typeof result.stdout:', typeof result.stdout);
  console.log('result.stderr:', result.stderr);
  console.log('result.code:', result.code);

  // Test various ways to get output
  console.log('\n=== Output extraction tests ===');
  console.log('result.stdout?.toString():', result.stdout?.toString());
  console.log('result.toString():', typeof result.toString === 'function' ? result.toString() : 'NOT A FUNCTION');
  console.log('String(result):', String(result));

  // Check for awaitable text() method
  if (typeof result.text === 'function') {
    console.log('result.text():', await result.text());
  }

  // Try extraction
  const output = result.stdout?.toString() || result.toString?.() || String(result) || '';
  console.log('\n=== Final output for regex ===');
  console.log('output:', JSON.stringify(output));

  const match2 = output.match(/issuecomment-(\d+)/);
  console.log('Match:', match2);

  if (match2 && match2[1]) {
    console.log('Deleting comment...');
    await $`gh api repos/link-assistant/hive-mind/issues/comments/${match2[1]} -X DELETE`;
    console.log('Deleted');
  } else {
    console.log('⚠️ Could not extract comment ID');
  }

} catch (e) {
  console.error('Error in command-stream test:', e);
}
