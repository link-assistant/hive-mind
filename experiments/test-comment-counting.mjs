#!/usr/bin/env node

// Test script to verify comment counting logic
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('Testing comment counting logic...');

// Mock values for testing
const owner = 'link-assistant';
const repo = 'hive-mind';
const prNumber = 82;
const issueNumber = 76;

// Test getting last commit timestamp
try {
  console.log('\n1. Testing last commit timestamp...');
  const lastCommitResult = await $`git log -1 --format="%aI" HEAD`;
  if (lastCommitResult.code === 0) {
    const lastCommitTime = new Date(lastCommitResult.stdout.toString().trim());
    console.log('✅ Last commit time:', lastCommitTime.toISOString());
  } else {
    console.log('❌ Failed to get last commit time');
  }
} catch (error) {
  console.log('❌ Error getting commit time:', error.message);
}

// Test getting PR comments (both code review and conversation)
try {
  console.log('\n2. Testing PR comments API...');

  // Get PR code review comments
  const prReviewCommentsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`;
  let prReviewComments = [];
  if (prReviewCommentsResult.code === 0) {
    prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString());
    console.log('✅ PR code review comments count:', prReviewComments.length);
  } else {
    console.log('❌ Failed to get PR code review comments');
  }

  // Get PR conversation comments (PR is also an issue)
  const prConversationCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments`;
  let prConversationComments = [];
  if (prConversationCommentsResult.code === 0) {
    prConversationComments = JSON.parse(prConversationCommentsResult.stdout.toString());
    console.log('✅ PR conversation comments count:', prConversationComments.length);
  } else {
    console.log('❌ Failed to get PR conversation comments');
  }

  // Combine all PR comments
  const allPrComments = [...prReviewComments, ...prConversationComments];
  console.log('✅ Total PR comments count:', allPrComments.length);
  if (allPrComments.length > 0) {
    console.log('   Latest comment:', new Date(allPrComments[allPrComments.length - 1].created_at).toISOString());
  }
} catch (error) {
  console.log('❌ Error getting PR comments:', error.message);
}

// Test getting issue comments
try {
  console.log('\n3. Testing issue comments API...');
  const issueCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  if (issueCommentsResult.code === 0) {
    const issueComments = JSON.parse(issueCommentsResult.stdout.toString());
    console.log('✅ Issue comments count:', issueComments.length);
    if (issueComments.length > 0) {
      console.log('   Latest comment:', new Date(issueComments[issueComments.length - 1].created_at).toISOString());
    }
  } else {
    console.log('❌ Failed to get issue comments');
  }
} catch (error) {
  console.log('❌ Error getting issue comments:', error.message);
}

// Test the jq sorting commands
try {
  console.log('\n4. Testing sorted comment commands...');

  // Test PR conversation comments (most common)
  const sortedPrConversationResult =
    await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq 'sort_by(.created_at) | reverse | .[0] | .created_at'`;
  if (sortedPrConversationResult.code === 0) {
    console.log('✅ Latest PR conversation comment sorted:', sortedPrConversationResult.stdout.toString().trim());
  }

  // Test PR code review comments
  const sortedPrReviewResult =
    await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --jq 'sort_by(.created_at) | reverse | .[0] | .created_at'`;
  if (sortedPrReviewResult.code === 0) {
    console.log('✅ Latest PR review comment sorted:', sortedPrReviewResult.stdout.toString().trim());
  }
} catch (error) {
  console.log('❌ Error with sorted PR commands:', error.message);
}

console.log('\n✅ Test completed!');
