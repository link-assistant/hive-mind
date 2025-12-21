#!/usr/bin/env node

/**
 * Test script to verify the feedback filtering functionality
 * Tests the new features implemented for issue #298:
 * - Getting current user from gh auth status
 * - Filtering out own comments made after work started
 * - Converting PR to draft/ready status
 * - Checking GitHub Actions on fork
 */

import { execSync } from 'child_process';

async function getCurrentUser() {
  try {
    const result = execSync('gh api user --jq .login', { encoding: 'utf8' });
    const currentUser = result.trim();
    console.log(`✅ Current GitHub user: ${currentUser}`);
    return currentUser;
  } catch (error) {
    console.error('❌ Failed to get current user:', error.message);
    return null;
  }
}

async function testPRDraftConversion(prNumber, owner, repo) {
  try {
    // Check current draft status
    const isDraftResult = execSync(`gh pr view ${prNumber} --repo ${owner}/${repo} --json isDraft --jq .isDraft`, {
      encoding: 'utf8'
    });
    const isDraft = isDraftResult.trim() === 'true';
    console.log(`📝 PR #${prNumber} draft status: ${isDraft}`);

    // Try to convert to draft
    if (!isDraft) {
      console.log('🔄 Converting to draft...');
      try {
        execSync(`gh pr ready ${prNumber} --repo ${owner}/${repo} --undo`, { encoding: 'utf8' });
        console.log('✅ Converted to draft');
      } catch (e) {
        console.log('⚠️ Could not convert to draft (might not have permission)');
      }
    }

    // Try to convert back to ready
    if (isDraft) {
      console.log('🔄 Converting to ready...');
      try {
        execSync(`gh pr ready ${prNumber} --repo ${owner}/${repo}`, { encoding: 'utf8' });
        console.log('✅ Converted to ready');
      } catch (e) {
        console.log('⚠️ Could not convert to ready (might not have permission)');
      }
    }
  } catch (error) {
    console.error('❌ Failed to test PR draft conversion:', error.message);
  }
}

async function testForkActionsDetection(forkOwner, forkRepo, branchName) {
  try {
    // Check if workflows exist
    const workflowsResult = execSync(
      `gh api repos/${forkOwner}/${forkRepo}/contents/.github/workflows --jq '.[].name' 2>/dev/null`,
      { encoding: 'utf8' }
    );
    const workflows = workflowsResult.trim();

    if (workflows) {
      const forkActionsUrl = `https://github.com/${forkOwner}/${forkRepo}/actions?query=branch%3A${encodeURIComponent(branchName)}`;
      console.log(`✅ Fork workflows detected: ${forkActionsUrl}`);
      console.log('   Workflows found:');
      workflows.split('\n').forEach(w => console.log(`   - ${w}`));
    } else {
      console.log('ℹ️ No workflows found on fork');
    }
  } catch (error) {
    console.log('ℹ️ No GitHub Actions workflows found on fork or no access');
  }
}

async function testCommentFiltering(owner, repo, prNumber, workStartTime) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      console.log('⚠️ Cannot test comment filtering without current user');
      return;
    }

    // Get PR comments
    const prCommentsResult = execSync(`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`, { encoding: 'utf8' });
    const prComments = JSON.parse(prCommentsResult);

    console.log(`📊 Total PR review comments: ${prComments.length}`);

    // Filter comments
    const filteredComments = prComments.filter(comment => {
      const commentTime = new Date(comment.created_at);
      const isOwnComment = comment.user && comment.user.login === currentUser;
      const isAfterWorkStart = workStartTime && commentTime > new Date(workStartTime);

      if (isOwnComment && isAfterWorkStart) {
        console.log(`   Filtered out: Comment from ${currentUser} at ${commentTime.toISOString()}`);
        return false;
      }
      return true;
    });

    console.log(`✅ Comments after filtering: ${filteredComments.length}`);
    console.log(`   Filtered out ${prComments.length - filteredComments.length} own comments made after work started`);
  } catch (error) {
    console.error('❌ Failed to test comment filtering:', error.message);
  }
}

// Main test function
async function runTests() {
  console.log('🧪 Testing feedback filtering features for issue #298\n');

  // Test 1: Get current user
  console.log('Test 1: Getting current user');
  await getCurrentUser();
  console.log();

  // Note: The following tests would require real PR/repo data to work
  // They are here to demonstrate the testing approach

  // Test 2: PR draft conversion (would need a real PR)
  console.log('Test 2: PR Draft Conversion (example - needs real PR)');
  console.log('⚠️ Skipping - would need real PR number and permissions');
  // await testPRDraftConversion(299, 'link-assistant', 'hive-mind');
  console.log();

  // Test 3: Fork actions detection (would need a real fork)
  console.log('Test 3: Fork Actions Detection (example - needs real fork)');
  console.log('⚠️ Skipping - would need real fork repository');
  // await testForkActionsDetection('someuser', 'hive-mind', 'issue-298-branch');
  console.log();

  // Test 4: Comment filtering (would need real PR data)
  console.log('Test 4: Comment Filtering (example - needs real PR)');
  console.log('⚠️ Skipping - would need real PR with comments');
  // const workStartTime = new Date(Date.now() - 3600000); // 1 hour ago
  // await testCommentFiltering('link-assistant', 'hive-mind', 299, workStartTime);
  console.log();

  console.log('✅ Test script complete!');
  console.log('\nNote: This is a demonstration of the testing approach.');
  console.log('Full integration testing would require a real PR with appropriate permissions.');
}

// Run tests
runTests().catch(console.error);
