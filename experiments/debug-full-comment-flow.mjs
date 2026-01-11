#!/usr/bin/env node

/**
 * Debug script to test the complete comment detection flow exactly as solve.mjs does
 * This will help us understand why comments might not be detected in real execution
 */

console.log('🔍 Full Comment Flow Debug');
console.log('==========================\n');

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

async function debugFullCommentFlow() {
  try {
    // Simulate the conditions from solve.mjs
    console.log('📋 Simulating exact solve.mjs conditions...\n');

    // Get current branch (should be issue-168-113ce685)
    const branchResult = await $('git branch --show-current');
    const branchName = branchResult.stdout.toString().trim();
    console.log(`🌿 Branch name: ${branchName}`);

    // Extract PR number from URL (like solve.mjs does)
    const prUrl = 'https://github.com/link-assistant/hive-mind/pull/169';
    const prMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prMatch ? parseInt(prMatch[1]) : null;
    console.log(`🔗 PR number: ${prNumber}`);

    // Extract owner and repo
    const owner = 'link-assistant';
    const repo = 'hive-mind';
    console.log(`📦 Owner/Repo: ${owner}/${repo}`);

    // Check the conditions that determine if comment counting runs
    console.log(`\\n📊 Comment counting conditions:`);
    console.log(`   prNumber: ${prNumber || 'NOT SET'}`);
    console.log(`   branchName: ${branchName || 'NOT SET'}`);
    console.log(`   Will count comments: ${!!(prNumber && branchName)}`);

    if (!prNumber) {
      console.log(`   ❌ PROBLEM: prNumber not set`);
      return false;
    }
    if (!branchName) {
      console.log(`   ❌ PROBLEM: branchName not set`);
      return false;
    }

    console.log('\\n🕐 Getting last commit time (exact solve.mjs logic)...');

    // Try origin/branch first, then fallback to local branch (exact solve.mjs logic)
    let lastCommitResult = await $(`git log -1 --format="%aI" origin/${branchName}`);
    if (lastCommitResult.code !== 0) {
      console.log('   Remote branch not found, falling back to local branch');
      lastCommitResult = await $(`git log -1 --format="%aI" ${branchName}`);
    }

    if (lastCommitResult.code !== 0) {
      console.log('   ❌ PROBLEM: Could not get last commit time');
      return false;
    }

    const lastCommitTime = new Date(lastCommitResult.stdout.toString().trim());
    console.log(`   ✅ Last commit time: ${lastCommitTime.toISOString()}`);

    console.log('\\n💬 Fetching PR comments (exact solve.mjs logic)...');

    // Get PR code review comments
    const prReviewCommentsResult = await $(`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`);
    let prReviewComments = [];
    if (prReviewCommentsResult.code === 0) {
      prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString());
      console.log(`   PR review comments: ${prReviewComments.length}`);
    } else {
      console.log(`   ❌ Failed to get PR review comments: ${prReviewCommentsResult.stderr}`);
    }

    // Get PR conversation comments (PR is also an issue)
    const prConversationCommentsResult = await $(`gh api repos/${owner}/${repo}/issues/${prNumber}/comments`);
    let prConversationComments = [];
    if (prConversationCommentsResult.code === 0) {
      prConversationComments = JSON.parse(prConversationCommentsResult.stdout.toString());
      console.log(`   PR conversation comments: ${prConversationComments.length}`);
    } else {
      console.log(`   ❌ Failed to get PR conversation comments: ${prConversationCommentsResult.stderr}`);
    }

    // Combine and count all PR comments after last commit
    const allPrComments = [...prReviewComments, ...prConversationComments];
    const newPrComments = allPrComments.filter(comment => new Date(comment.created_at) > lastCommitTime).length;

    console.log(`\\n📊 Results:`);
    console.log(`   Total PR comments: ${allPrComments.length}`);
    console.log(`   New PR comments since last commit: ${newPrComments}`);

    // Show details of recent comments
    if (allPrComments.length > 0) {
      console.log(`\\n📝 Recent comment details:`);
      const recentComments = allPrComments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 3);

      recentComments.forEach((comment, i) => {
        const createdAt = new Date(comment.created_at);
        const isNew = createdAt > lastCommitTime;
        console.log(`     ${i + 1}. ${createdAt.toISOString()} ${isNew ? '(NEW)' : '(OLD)'}`);
        console.log(`        Author: ${comment.user.login}`);
        console.log(`        Body length: ${comment.body.length} chars`);

        // Check if this would be filtered by log patterns
        const logPatterns = [/📊.*Log file|solution.*log/i, /🔗.*Link:|💻.*Session:/i, /Generated with.*solve\\.mjs/i, /Session ID:|Log file available:/i];
        const wouldBeFiltered = logPatterns.some(pattern => pattern.test(comment.body || ''));
        if (wouldBeFiltered) {
          console.log(`        🚫 Would be filtered as log comment`);
        }
      });
    }

    // Test feedback lines generation
    console.log(`\\n🎯 Testing feedback lines generation:`);
    let feedbackLines = [];
    if (newPrComments > 0) {
      feedbackLines.push(`New comments on the pull request: ${newPrComments}`);
    }

    console.log(`   Generated ${feedbackLines.length} feedback lines:`);
    feedbackLines.forEach((line, i) => {
      console.log(`     ${i + 1}. ${line}`);
    });

    return newPrComments > 0;
  } catch (error) {
    console.error(`\\n❌ Error: ${error.message}`);
    return false;
  }
}

const result = await debugFullCommentFlow();

console.log(`\\n🎯 Overall Result: ${result ? 'COMMENTS DETECTED' : 'NO COMMENTS DETECTED'}`);
if (!result) {
  console.log('This may explain why comments are not being counted in real execution.');
}
