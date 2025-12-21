#!/usr/bin/env node

/**
 * Debug script to test comment detection in real scenarios
 * This will help us understand if the core comment counting logic is working
 */

console.log('🔍 Debug: Comment Detection Test');
console.log('==================================\n');

// Import required modules
const { execSync } = await import('child_process');

// Helper function to run commands
async function $(command) {
  try {
    const stdout = execSync(command, { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status || 1, stderr: error.message };
  }
}

async function debugCommentDetection() {
  try {
    // Test with the current PR #169
    const owner = 'link-assistant';
    const repo = 'hive-mind';
    const prNumber = 169;

    console.log(`📊 Testing comment detection for PR #${prNumber}...\n`);

    // Get last commit time (similar to solve.mjs logic)
    const lastCommitResult = await $('git log -1 --format="%cI"');
    if (lastCommitResult.code !== 0) {
      throw new Error('Failed to get last commit time');
    }
    const lastCommitTime = new Date(lastCommitResult.stdout.toString().trim());
    console.log(`⏰ Last commit time: ${lastCommitTime.toISOString()}`);

    // Get PR review comments
    console.log('\n🔍 Fetching PR review comments...');
    const prReviewCommentsResult = await $(`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`);
    let prReviewComments = [];
    if (prReviewCommentsResult.code === 0) {
      prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString());
      console.log(`   Found ${prReviewComments.length} total review comments`);
    } else {
      console.log('   Failed to fetch review comments');
    }

    // Get PR conversation comments
    console.log('\n💬 Fetching PR conversation comments...');
    const prConversationCommentsResult = await $(`gh api repos/${owner}/${repo}/issues/${prNumber}/comments`);
    let prConversationComments = [];
    if (prConversationCommentsResult.code === 0) {
      prConversationComments = JSON.parse(prConversationCommentsResult.stdout.toString());
      console.log(`   Found ${prConversationComments.length} total conversation comments`);

      // Debug: show the latest comments
      const latestComments = prConversationComments
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 3);

      console.log('   Latest comments:');
      latestComments.forEach((comment, i) => {
        const createdAt = new Date(comment.created_at);
        const isNew = createdAt > lastCommitTime;
        console.log(`     ${i + 1}. ${createdAt.toISOString()} ${isNew ? '(NEW)' : '(OLD)'}`);
        console.log(`        Author: ${comment.user.login}`);
        console.log(`        Preview: ${comment.body.substring(0, 100)}...`);
      });
    } else {
      console.log('   Failed to fetch conversation comments');
    }

    // Count new comments after last commit
    const allPrComments = [...prReviewComments, ...prConversationComments];
    const newPrComments = allPrComments.filter(comment => new Date(comment.created_at) > lastCommitTime).length;

    console.log(`\n📈 Comment Analysis:`);
    console.log(`   Total PR comments: ${allPrComments.length}`);
    console.log(`   New comments since last commit: ${newPrComments}`);

    // Test feedback line generation (same logic as solve.mjs)
    let feedbackLines = [];
    if (newPrComments > 0) {
      feedbackLines.push(`New comments on the pull request: ${newPrComments}`);
    }

    console.log(`\n🎯 Feedback Lines Generation:`);
    console.log(`   Generated ${feedbackLines.length} feedback lines:`);
    feedbackLines.forEach((line, i) => {
      console.log(`     ${i + 1}. ${line}`);
    });

    // Test continue mode logic
    const isContinueMode = true; // Simulate continue mode
    if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
      console.log(`\n✅ Continue mode: Feedback lines would be added to prompt`);
      return true;
    } else {
      console.log(`\n❌ Continue mode: No feedback lines would be added`);
      return false;
    }
  } catch (error) {
    console.error(`\n❌ Error during comment detection test: ${error.message}`);
    return false;
  }
}

const result = await debugCommentDetection();

console.log(`\n🎯 Overall Result: ${result ? 'WORKING' : 'NOT WORKING'}`);
if (!result) {
  console.log('The comment detection logic may have issues that need investigation.');
}
