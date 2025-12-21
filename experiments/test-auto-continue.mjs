#!/usr/bin/env node

// Simple test script to validate auto-continue logic
// This script tests the date logic without making actual API calls

console.log('🧪 Testing auto-continue date logic...');

// Mock PR data similar to what GitHub API would return
const mockPRs = [
  {
    number: 1,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
    headRefName: 'issue-28-abc123',
    isDraft: true,
    state: 'OPEN',
  },
  {
    number: 2,
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
    headRefName: 'issue-28-def456',
    isDraft: false,
    state: 'OPEN',
  },
  {
    number: 3,
    createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(), // 30 hours ago
    headRefName: 'issue-28-ghi789',
    isDraft: false,
    state: 'CLOSED',
  },
];

// Test the auto-continue logic
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

  // Check if this PR is older than 24 hours and not closed
  if (createdAt < twentyFourHoursAgo && pr.state === 'OPEN') {
    console.log(`   ✅ Qualifies for auto-continue (${ageHours}h > 24h, OPEN)`);
    if (!selectedPR) {
      selectedPR = pr;
      console.log(`   🎯 Selected this PR for auto-continue`);
    }
  } else {
    const reason = createdAt >= twentyFourHoursAgo ? 'too new' : 'not open';
    console.log(`   ❌ Does not qualify (${reason})`);
  }
}

console.log('');
if (selectedPR) {
  console.log(`✅ Auto-continue would use PR #${selectedPR.number} on branch ${selectedPR.headRefName}`);
} else {
  console.log(`⏭️  No qualifying PRs found - would create new PR`);
}

console.log('');
console.log('🧪 Test completed successfully!');
