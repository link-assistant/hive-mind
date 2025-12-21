#!/usr/bin/env node

// Test script to verify the error message for fork PRs

async function formatAligned(icon, label, value, leftPad = 0) {
  const padding = ' '.repeat(leftPad);
  const labelPadded = label.padEnd(25);
  return `${padding}${icon} ${labelPadded} ${value}`;
}

async function log(message) {
  console.log(message);
}

// Mock scenario: fork PR branch checkout failure
async function simulateForkedPRError() {
  const isForkPR = true;
  const issueUrl = 'https://github.com/suenot/tinkoff-invest-etf-balancer-bot/pull/39';
  const prNumber = 39;
  const owner = 'suenot';
  const repo = 'tinkoff-invest-etf-balancer-bot';
  const branchName = 'issue-3-6da5c9ab';
  const tempDir = '/tmp/test-directory';
  const errorOutput =
    "fatal: 'origin/issue-3-6da5c9ab' is not a commit and a branch 'issue-3-6da5c9ab' cannot be created from it";

  console.log('🔍 Testing forked PR error message output:');
  console.log('========================================');
  console.log('');

  await log(`${await formatAligned('❌', 'BRANCH CHECKOUT FAILED', '')}`);
  await log(``);
  await log(`  🔍 What happened:`);
  await log(`     Unable to checkout PR branch '${branchName}'.`);
  await log(``);
  await log(`  📦 Git output:`);
  for (const line of errorOutput.split('\n')) {
    await log(`     ${line}`);
  }
  await log(``);
  await log(`  💡 Possible causes:`);
  await log(`     • PR branch doesn't exist on remote`);
  await log(`     • Network connectivity issues`);
  await log(`     • Permission denied to fetch branches`);
  if (isForkPR) {
    await log(`     • This is a forked PR - branch is in the fork, not the main repo`);
  }
  await log(``);
  await log(`  🔧 How to fix:`);
  if (isForkPR) {
    await log(`     1. Use --fork option (RECOMMENDED for forked PRs):`);
    await log(`        ./solve.mjs "${issueUrl}" --fork`);
    await log(`        This will create a fork and work from there.`);
    await log(``);
    await log(`     2. Alternative diagnostic steps:`);
    await log(`        • Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`        • Check remote branches: cd ${tempDir} && git branch -r`);
    await log(`        • Try fetching manually: cd ${tempDir} && git fetch origin`);
  } else {
    await log(`     1. Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`     2. Check remote branches: cd ${tempDir} && git branch -r`);
    await log(`     3. Try fetching manually: cd ${tempDir} && git fetch origin`);
  }
  await log(``);
  await log(`  📂 Working directory: ${tempDir}`);
}

async function simulateNormalPRError() {
  const isForkPR = false;
  const prNumber = 123;
  const owner = 'link-assistant';
  const repo = 'hive-mind';
  const branchName = 'issue-123-abcd1234';
  const tempDir = '/tmp/test-directory';
  const errorOutput = "fatal: A branch named 'issue-123-abcd1234' already exists.";

  console.log('🔍 Testing normal PR error message output:');
  console.log('=========================================');
  console.log('');

  await log(`${await formatAligned('❌', 'BRANCH CHECKOUT FAILED', '')}`);
  await log(``);
  await log(`  🔍 What happened:`);
  await log(`     Unable to checkout PR branch '${branchName}'.`);
  await log(``);
  await log(`  📦 Git output:`);
  for (const line of errorOutput.split('\n')) {
    await log(`     ${line}`);
  }
  await log(``);
  await log(`  💡 Possible causes:`);
  await log(`     • PR branch doesn't exist on remote`);
  await log(`     • Network connectivity issues`);
  await log(`     • Permission denied to fetch branches`);
  if (isForkPR) {
    await log(`     • This is a forked PR - branch is in the fork, not the main repo`);
  }
  await log(``);
  await log(`  🔧 How to fix:`);
  if (isForkPR) {
    await log(`     1. Use --fork option (RECOMMENDED for forked PRs):`);
    await log(`        ./solve.mjs "https://example.com/pr" --fork`);
    await log(`        This will create a fork and work from there.`);
    await log(``);
    await log(`     2. Alternative diagnostic steps:`);
    await log(`        • Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`        • Check remote branches: cd ${tempDir} && git branch -r`);
    await log(`        • Try fetching manually: cd ${tempDir} && git fetch origin`);
  } else {
    await log(`     1. Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`     2. Check remote branches: cd ${tempDir} && git branch -r`);
    await log(`     3. Try fetching manually: cd ${tempDir} && git fetch origin`);
  }
  await log(``);
  await log(`  📂 Working directory: ${tempDir}`);
}

// Run both tests
await simulateForkedPRError();
console.log('\n' + '='.repeat(60) + '\n');
await simulateNormalPRError();

console.log('\n✅ Error message tests completed successfully!');
