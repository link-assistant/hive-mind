#!/usr/bin/env node

// Test script to verify fork detection logic

// Mock GitHub CLI output for forked PR
const forkPRData = {
  headRefName: "issue-3-6da5c9ab",
  body: "Fixes #3",
  number: 39,
  mergeStateStatus: "CLEAN",
  headRepositoryOwner: {
    login: "different-user"  // Different from repo owner
  }
};

// Mock GitHub CLI output for non-forked PR
const normalPRData = {
  headRefName: "issue-163-219b7547",
  body: "Fixes #163",
  number: 176,
  mergeStateStatus: "CLEAN",
  headRepositoryOwner: {
    login: "link-assistant"  // Same as repo owner
  }
};

// Test the fork detection logic
function testForkDetection(prData, repoOwner) {
  const isForkPR = prData.headRepositoryOwner && prData.headRepositoryOwner.login !== repoOwner;
  console.log(`PR #${prData.number}:`);
  console.log(`  Head repository owner: ${prData.headRepositoryOwner.login}`);
  console.log(`  Repo owner: ${repoOwner}`);
  console.log(`  Is fork PR: ${isForkPR}`);
  console.log('');
  return isForkPR;
}

console.log('Testing fork detection logic:');
console.log('============================');

// Test with forked PR
const isFork1 = testForkDetection(forkPRData, "original-owner");

// Test with normal PR
const isFork2 = testForkDetection(normalPRData, "link-assistant");

// Verify results
console.log('Results:');
console.log(`Forked PR correctly detected: ${isFork1 === true}`);
console.log(`Normal PR correctly detected: ${isFork2 === false}`);

if (isFork1 === true && isFork2 === false) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Tests failed!');
  process.exit(1);
}