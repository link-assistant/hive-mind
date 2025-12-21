#!/usr/bin/env node

import { readFile } from 'fs/promises';
import path from 'path';

// Test to verify the PR comment message has been updated correctly
async function testPRCommentMessage() {
  console.log('Testing PR comment message update...');

  try {
    // Read the solve.mjs file
    const solvePath = path.join(process.cwd(), 'src', 'solve.mjs');
    const content = await readFile(solvePath, 'utf-8');

    // Check that the old message is not present
    const oldMessage = 'Comments made after this time by the AI tool will not be counted as feedback.';
    if (content.includes(oldMessage)) {
      console.error('❌ Error: Old message still found in solve.mjs');
      console.error(`   Found: "${oldMessage}"`);
      process.exit(1);
    }

    // Check that the new message is present
    const newMessage = 'Please wait working session to finish, and provide your feedback.';
    if (!content.includes(newMessage)) {
      console.error('❌ Error: New message not found in solve.mjs');
      console.error(`   Expected: "${newMessage}"`);
      process.exit(1);
    }

    // Verify the message is in the correct context
    const commentPattern =
      /const startComment = `[^`]*Please wait working session to finish, and provide your feedback\.[^`]*`;/;
    if (!commentPattern.test(content)) {
      console.error('❌ Error: New message not found in the correct context');
      process.exit(1);
    }

    console.log('✅ PR comment message has been successfully updated');
    console.log('   Old message removed: ✓');
    console.log('   New message added: ✓');
    console.log('   Message in correct context: ✓');
  } catch (error) {
    console.error('❌ Error during test:', error.message);
    process.exit(1);
  }
}

// Run the test
testPRCommentMessage();
