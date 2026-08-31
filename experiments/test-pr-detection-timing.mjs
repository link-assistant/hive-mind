#!/usr/bin/env node
/**
 * Experiment: Test PR detection timing
 *
 * Purpose: Understand the delay between PR creation and GraphQL API availability
 *
 * This experiment helps us understand when cross-reference events become
 * queryable after PR creation, which is critical for the /hive command's
 * PR detection logic.
 *
 * Usage:
 *   node experiments/test-pr-detection-timing.mjs <owner> <repo> <issue-number> <pr-number>
 *
 * Example:
 *   node experiments/test-pr-detection-timing.mjs deep-assistant hive-mind 698 699
 */

import { execSync } from 'child_process';

const [owner, repo, issueNumber, prNumber] = process.argv.slice(2);

if (!owner || !repo || !issueNumber || !prNumber) {
  console.error('Usage: node test-pr-detection-timing.mjs <owner> <repo> <issue-number> <pr-number>');
  console.error('Example: node test-pr-detection-timing.mjs deep-assistant hive-mind 698 699');
  process.exit(1);
}

console.log('🔬 PR Detection Timing Experiment');
console.log('=================================\n');
console.log(`Repository: ${owner}/${repo}`);
console.log(`Issue: #${issueNumber}`);
console.log(`PR: #${prNumber}\n`);

// Get PR creation time
const prData = JSON.parse(execSync(
  `gh pr view ${prNumber} --repo ${owner}/${repo} --json number,createdAt,state,isDraft`,
  { encoding: 'utf8' }
));

console.log(`PR #${prNumber} Details:`);
console.log(`  Created: ${prData.createdAt}`);
console.log(`  State: ${prData.state}`);
console.log(`  Is Draft: ${prData.isDraft}\n`);

// Check current GraphQL response
const query = `
query {
  repository(owner: "${owner}", name: "${repo}") {
    issue(number: ${issueNumber}) {
      number
      title
      state
      timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
        nodes {
          ... on CrossReferencedEvent {
            createdAt
            source {
              ... on PullRequest {
                number
                title
                state
                isDraft
                url
                createdAt
              }
            }
          }
        }
      }
    }
  }
}
`;

console.log('Running GraphQL query for cross-reference events...\n');

try {
  const result = execSync(`gh api graphql -f query='${query}'`, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  const data = JSON.parse(result);
  const issue = data.data?.repository?.issue;

  if (!issue) {
    console.error('❌ Failed to fetch issue data');
    process.exit(1);
  }

  console.log(`Issue #${issueNumber} Details:`);
  console.log(`  Title: ${issue.title}`);
  console.log(`  State: ${issue.state}\n`);

  const crossRefEvents = issue.timelineItems?.nodes || [];
  console.log(`Found ${crossRefEvents.length} cross-reference event(s):\n`);

  let foundPR = false;
  for (const event of crossRefEvents) {
    if (event?.source) {
      const pr = event.source;
      console.log(`  PR #${pr.number}: ${pr.title}`);
      console.log(`    Created: ${pr.createdAt}`);
      console.log(`    Event Created: ${event.createdAt}`);
      console.log(`    State: ${pr.state}`);
      console.log(`    Is Draft: ${pr.isDraft}`);

      // Calculate delay between PR creation and event creation
      const prTime = new Date(pr.createdAt);
      const eventTime = new Date(event.createdAt);
      const delaySeconds = (eventTime - prTime) / 1000;
      console.log(`    Event Delay: ${delaySeconds.toFixed(2)} seconds\n`);

      if (pr.number === parseInt(prNumber)) {
        foundPR = true;

        // Check if it would be detected by current logic
        const wouldBeDetected = pr.state === 'OPEN' && !pr.isDraft;
        console.log(`    ✅ Would be detected by current logic: ${wouldBeDetected ? 'YES' : 'NO'}\n`);
      }
    }
  }

  if (!foundPR) {
    console.log(`⚠️  PR #${prNumber} NOT found in cross-reference events!`);
    console.log(`This indicates the cross-reference event is not yet indexed in GraphQL.\n`);
  }

  // Calculate how long ago the PR was created
  const now = new Date();
  const prCreated = new Date(prData.createdAt);
  const ageMinutes = (now - prCreated) / 1000 / 60;

  console.log(`\n📊 Analysis:`);
  console.log(`  PR Age: ${ageMinutes.toFixed(2)} minutes`);
  console.log(`  Detected: ${foundPR ? 'YES ✅' : 'NO ❌'}`);

  if (foundPR) {
    console.log(`\n✅ SUCCESS: PR is currently detectable by /hive command`);
  } else {
    console.log(`\n⚠️  WARNING: PR is NOT currently detectable by /hive command`);
    console.log(`This could indicate:`);
    console.log(`  1. Cross-reference event not yet indexed by GitHub API`);
    console.log(`  2. PR does not reference the issue in body/title`);
    console.log(`  3. GraphQL API delay/issue`);
  }

} catch (error) {
  console.error('❌ Error running GraphQL query:', error.message);
  process.exit(1);
}

console.log('\n' + '='.repeat(50));
console.log('Experiment complete!');
console.log('='.repeat(50));
