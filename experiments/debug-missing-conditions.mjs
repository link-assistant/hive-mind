#!/usr/bin/env node

// Debug script to identify why detailed comment counting might not run
// This investigates the conditions that could make (prNumber && branchName) false

import { execSync } from 'child_process';

function debugMissingConditions() {
  console.log('DEBUGGING WHY DETAILED COMMENT COUNTING MIGHT NOT RUN');
  console.log('='.repeat(70));

  console.log('\nChecking current conditions that affect comment counting:\n');

  // Check current git branch
  try {
    const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    console.log(`✅ Current branch: "${currentBranch}"`);
    console.log(`   branchName would be: "${currentBranch}"`);
    console.log(`   branchName truthy? ${!!currentBranch}`);

    if (!currentBranch) {
      console.log('❌ PROBLEM: branchName would be empty/falsy!');
      console.log('   This would prevent detailed comment counting from running.');
      console.log('   The condition (prNumber && branchName) would be false.');
      return;
    }
  } catch (error) {
    console.log(`❌ Git branch check failed: ${error.message}`);
    return;
  }

  // Simulate how prNumber would be determined in continue mode
  console.log('\n2. CHECKING PR NUMBER CONDITIONS:');

  // In continue mode, prNumber comes from different sources:
  console.log('   In continue mode, prNumber could come from:');
  console.log('   a) Command line argument (argv.prUrl)');
  console.log('   b) Extracted from existing PR URL');
  console.log('   c) Found via gh pr list for current branch');

  try {
    // Test if we can find a PR for the current branch
    const branchName = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

    try {
      const prListResult = execSync(`gh pr list --head ${branchName} --json number,url --limit 1`, {
        encoding: 'utf8',
        stdio: 'pipe'
      });

      const prs = JSON.parse(prListResult.trim() || '[]');

      if (prs.length > 0) {
        const prNumber = prs[0].number;
        const prUrl = prs[0].url;
        console.log(`✅ Found PR via gh pr list:`);
        console.log(`   PR Number: ${prNumber}`);
        console.log(`   PR URL: ${prUrl}`);
        console.log(`   prNumber truthy? ${!!prNumber}`);

        // Check if the condition would pass
        const conditionPasses = prNumber && branchName;
        console.log(`\n✅ FINAL CONDITION CHECK:`);
        console.log(`   (prNumber && branchName): ${conditionPasses}`);

        if (conditionPasses) {
          console.log(`✅ Detailed comment counting SHOULD run!`);
          console.log(`\n🤔 If user is still seeing "None found", the issue might be:`);
          console.log(`   1. They're looking at logs from timestamp section (line 2213)`);
          console.log(`   2. NOT looking at the detailed counting logs (line 2054-2055)`);
          console.log(`   3. The detailed counting IS running but they're not seeing it`);
          console.log(`   4. There's a different execution path or timing issue`);
        } else {
          console.log(`❌ Detailed comment counting would NOT run!`);
        }
      } else {
        console.log(`❌ No PR found for current branch "${branchName}"`);
        console.log(`   This would make prNumber falsy/undefined`);
        console.log(`   The condition (prNumber && branchName) would be false`);
        console.log(`❌ PROBLEM IDENTIFIED: No PR found for branch!`);
      }
    } catch (ghError) {
      console.log(`❌ gh pr list failed: ${ghError.message}`);
      console.log(`   This suggests either:`);
      console.log(`   - No GitHub auth`);
      console.log(`   - Not in a GitHub repo`);
      console.log(`   - No PR exists for this branch`);
    }
  } catch (error) {
    console.log(`❌ Error checking PR conditions: ${error.message}`);
  }

  console.log("\n3. TESTING USER'S EXACT SCENARIO:");
  console.log('   Based on user logs, they have:');
  console.log('   - Branch: issue-108-33029b6d (from logs)');
  console.log('   - PR: #109 (from logs)');
  console.log('   - Continue mode: true');
  console.log('   - Should see detailed comment counting');

  console.log('\n4. ANALYZING THE LOGS:');
  console.log('   User sees: "💬 Comments: None found"');
  console.log('   This comes from line 2213 (timestamp gathering)');
  console.log('   User SHOULD ALSO see: "💬 Counting comments: Checking..."');
  console.log('   And then: "💬 New PR comments: X" and "💬 New issue comments: Y"');
  console.log('   ');
  console.log("   If they're NOT seeing the detailed counting logs,");
  console.log('   then (prNumber && branchName) is false somehow.');
}

debugMissingConditions();
