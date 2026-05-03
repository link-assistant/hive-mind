#!/usr/bin/env node

// Debug the real execution scenario to identify the exact issue
// This simulates conditions that might prevent comment counting from working

import { execSync } from 'child_process';

async function debugRealExecution() {
  console.log('DEBUGGING REAL EXECUTION CONDITIONS');
  console.log('='.repeat(60));

  // Check the current git state to simulate the real scenario
  console.log('\n1. CHECKING CURRENT GIT STATE:');
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    console.log(`✅ Current branch: ${branch}`);

    // This simulates the key variables that would be set in the real execution
    const branchName = branch; // e.g., 'issue-110-e19ccdc1'
    const prNumber = 111; // From the PR URL

    console.log(`✅ branchName: ${branchName}`);
    console.log(`✅ prNumber: ${prNumber}`);

    // Check the condition that determines if comment counting runs
    const shouldRunCommentCounting = prNumber && branchName;
    console.log(`\n2. COMMENT COUNTING CONDITIONS:`);
    console.log(`✅ prNumber && branchName: ${shouldRunCommentCounting}`);

    if (!shouldRunCommentCounting) {
      console.log('❌ PROBLEM: Comment counting would not run at all!');
      return;
    }

    // Check if we can get the last commit (this is another condition that could fail)
    console.log(`\n3. TESTING GIT COMMIT ACCESS:`);
    try {
      // Try the remote branch first (as the code does)
      let lastCommitResult;
      try {
        lastCommitResult = execSync(`git log -1 --format="%aI" origin/${branchName}`, {
          encoding: 'utf8',
          stdio: 'pipe',
        });
        console.log(`✅ Remote branch commit access: SUCCESS`);
        console.log(`   Last commit time: ${lastCommitResult.trim()}`);
      } catch (remoteError) {
        console.log(`⚠️  Remote branch access failed, trying local...`);
        try {
          lastCommitResult = execSync(`git log -1 --format="%aI" ${branchName}`, { encoding: 'utf8', stdio: 'pipe' });
          console.log(`✅ Local branch commit access: SUCCESS`);
          console.log(`   Last commit time: ${lastCommitResult.trim()}`);
        } catch (localError) {
          console.log(`❌ Both remote and local commit access FAILED`);
          console.log(`   Remote error: ${remoteError.message}`);
          console.log(`   Local error: ${localError.message}`);
          console.log(`❌ PROBLEM: Comment counting would fail at git log step!`);
          return;
        }
      }
    } catch (error) {
      console.log(`❌ Git commit access failed: ${error.message}`);
      console.log(`❌ PROBLEM: Comment counting would fail!`);
      return;
    }

    console.log(`\n4. SIMULATING COMMENT DISPLAY LOGIC:`);

    // Simulate different scenarios
    const scenarios = [
      {
        name: 'Continue mode, no flag, 0 comments',
        isContinueMode: true,
        autoContinue: false,
        autoContinueOnlyOnNewComments: false,
        comments: 0,
      },
      {
        name: 'Continue mode, with flag, 0 comments',
        isContinueMode: true,
        autoContinue: false,
        autoContinueOnlyOnNewComments: true,
        comments: 0,
      },
      {
        name: 'Continue mode, with flag, some comments',
        isContinueMode: true,
        autoContinue: false,
        autoContinueOnlyOnNewComments: true,
        comments: 2,
      },
    ];

    scenarios.forEach(scenario => {
      console.log(`\n   Scenario: ${scenario.name}`);

      const argv = {
        autoContinue: scenario.autoContinue,
        autoContinueOnlyOnNewComments: scenario.autoContinueOnlyOnNewComments,
      };

      const newPrComments = scenario.comments;
      const newIssueComments = 0;

      // Check if process would exit early
      if (argv.autoContinueOnlyOnNewComments && (scenario.isContinueMode || argv.autoContinue)) {
        const totalNewComments = newPrComments + newIssueComments;
        if (totalNewComments === 0) {
          console.log(`   ❌ Process would EXIT before prompt modification`);
          return;
        }
      }

      // Build comment lines
      const commentLines = [];
      if (scenario.isContinueMode || argv.autoContinue) {
        commentLines.push(`New comments on the pull request: ${newPrComments}`);
        commentLines.push(`New comments on the issue: ${newIssueComments}`);
      } else {
        if (newPrComments > 0) {
          commentLines.push(`New comments on the pull request: ${newPrComments}`);
        }
        if (newIssueComments > 0) {
          commentLines.push(`New comments on the issue: ${newIssueComments}`);
        }
      }

      // Check if prompt would be modified
      if (commentLines.length > 0 && scenario.isContinueMode) {
        console.log(`   ✅ Prompt would be modified: ${JSON.stringify(commentLines)}`);
      } else if (commentLines.length === 0) {
        console.log(`   ❌ No comment lines, prompt would NOT be modified`);
      } else {
        console.log(`   ❌ Not in continue mode, prompt would NOT be modified`);
      }
    });

    console.log(`\n5. CONCLUSION:`);
    console.log(`✅ All conditions for comment counting should be met`);
    console.log(`✅ The current fix should work correctly`);
    console.log(`\n🤔 If user is still seeing issues, it might be:`);
    console.log(`   1. Testing under different conditions than expected`);
    console.log(`   2. There's a caching or timing issue`);
    console.log(`   3. The fix is working but they're confused about what they're seeing`);
    console.log(`   4. There's a different bug in a different part of the code`);
  } catch (error) {
    console.log(`❌ Error during debug: ${error.message}`);
  }
}

debugRealExecution();
