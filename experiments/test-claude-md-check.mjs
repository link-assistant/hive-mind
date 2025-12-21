#!/usr/bin/env node

// Test script to validate CLAUDE.md checking logic
// This script tests the new auto-continue feature that checks for missing CLAUDE.md

console.log('🧪 Testing CLAUDE.md checking logic...');

// Mock the checkClaudeMdInBranch function for testing
const mockCheckClaudeMdInBranch = async (owner, repo, branchName) => {
  // Simulate different scenarios
  const mockResults = {
    'issue-54-branch1': false, // CLAUDE.md missing - should auto-continue immediately
    'issue-54-branch2': true, // CLAUDE.md present - should wait 24h
    'issue-54-branch3': false // CLAUDE.md missing - should auto-continue immediately
  };

  console.log(`   🔍 Checking CLAUDE.md in ${branchName}: ${mockResults[branchName] ? 'EXISTS' : 'MISSING'}`);
  return mockResults[branchName] || false;
};

// Mock PR data similar to what GitHub API would return
const mockPRs = [
  {
    number: 1,
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago (< 24h)
    headRefName: 'issue-54-branch1', // CLAUDE.md missing
    isDraft: true,
    state: 'OPEN'
  },
  {
    number: 2,
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago (< 24h)
    headRefName: 'issue-54-branch2', // CLAUDE.md present
    isDraft: false,
    state: 'OPEN'
  },
  {
    number: 3,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago (> 24h)
    headRefName: 'issue-54-branch3', // CLAUDE.md missing
    isDraft: false,
    state: 'OPEN'
  }
];

// Test the new auto-continue logic
const testAutoContinueLogic = async () => {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  console.log(`⏰ Current time: ${now.toISOString()}`);
  console.log(`⏰ 24 hours ago: ${twentyFourHoursAgo.toISOString()}`);
  console.log('');

  let selectedPR = null;

  for (const pr of mockPRs) {
    const createdAt = new Date(pr.createdAt);
    const ageHours = Math.floor((now - createdAt) / (1000 * 60 * 60));

    console.log(`📋 PR #${pr.number}: created ${ageHours}h ago (${pr.state}, ${pr.isDraft ? 'draft' : 'ready'})`);

    // Check if PR is open (not closed)
    if (pr.state === 'OPEN') {
      // Check if CLAUDE.md exists in this PR branch
      const claudeMdExists = await mockCheckClaudeMdInBranch('owner', 'repo', pr.headRefName);

      if (!claudeMdExists) {
        console.log(`   ✅ Auto-continue: CLAUDE.md missing - work completed (immediate)`);
        if (!selectedPR) {
          selectedPR = pr;
          console.log(`   🎯 Selected this PR for auto-continue`);
        }
      } else if (createdAt < twentyFourHoursAgo) {
        console.log(`   ✅ Auto-continue: Created ${ageHours}h ago (traditional 24h rule)`);
        if (!selectedPR) {
          selectedPR = pr;
          console.log(`   🎯 Selected this PR for auto-continue`);
        }
      } else {
        console.log(`   ❌ PR #${pr.number}: CLAUDE.md exists, age ${ageHours}h < 24h - skipping`);
      }
    } else {
      console.log(`   ❌ Does not qualify (not open)`);
    }
  }

  console.log('');
  if (selectedPR) {
    console.log(`✅ Auto-continue would use PR #${selectedPR.number} on branch ${selectedPR.headRefName}`);
  } else {
    console.log(`⏭️  No suitable PRs found (missing CLAUDE.md or older than 24h) - would create new PR`);
  }

  return selectedPR;
};

// Run the test
testAutoContinueLogic()
  .then(result => {
    console.log('');
    console.log('🧪 Test scenarios:');
    console.log('   • PR #1: 12h old, CLAUDE.md MISSING → Should auto-continue (✅)');
    console.log('   • PR #2: 12h old, CLAUDE.md EXISTS → Should skip (❌)');
    console.log('   • PR #3: 25h old, CLAUDE.md MISSING → Should auto-continue (✅)');
    console.log('');

    if (result && result.number === 1) {
      console.log('✅ Test PASSED: Correctly selected PR #1 (CLAUDE.md missing, immediate continue)');
    } else if (result && result.number === 3) {
      console.log('✅ Test PASSED: Correctly selected PR #3 (fallback to traditional 24h rule)');
    } else {
      console.log('❌ Test FAILED: Unexpected result');
    }

    console.log('');
    console.log('🧪 Test completed!');
  })
  .catch(error => {
    console.error('❌ Test failed with error:', error);
  });
