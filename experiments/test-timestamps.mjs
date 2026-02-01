#!/usr/bin/env node
// Test script to debug GitHub timestamp fetching logic

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Test with the same repo/issue from the error
const owner = 'link-foundation';
const repo = 'gh-pull-all';
const issueNumber = '11';

console.log(`Testing GitHub API calls for ${owner}/${repo}/issues/${issueNumber}`);
console.log('');

async function testGitHubApiCall(description, command) {
  console.log(`Testing: ${description}`);
  console.log(`Command: ${command}`);

  try {
    const result = await $`gh ${command.split(' ').slice(1)}`;
    console.log(`✓ Success`);
    console.log(`  Type of result:`, typeof result);
    console.log(`  Result keys:`, Object.keys(result));
    console.log(`  stdout type:`, typeof result.stdout);

    // Convert Buffer to string if needed
    const stdoutString = result.stdout.toString();
    console.log(`  stdout as string:`, JSON.stringify(stdoutString));
    console.log(`  trimmed:`, JSON.stringify(stdoutString.trim()));

    return { ...result, stdout: stdoutString };
  } catch (error) {
    console.log(`✗ Error:`, error.message);
    console.log(`  Error type:`, typeof error);
    console.log(`  Error keys:`, Object.keys(error));
    if (error.stdout !== undefined) {
      console.log(`  Error stdout:`, JSON.stringify(error.stdout.toString()));
    }
    if (error.stderr !== undefined) {
      console.log(`  Error stderr:`, JSON.stringify(error.stderr.toString()));
    }
    return null;
  }
  console.log('');
}

// Test individual API calls with corrected commands
console.log('\n=== Testing corrected commands ===\n');

// Test 1: Issue updated time (this one works)
try {
  const issueResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .updated_at`;
  const issueUpdatedAt = new Date(issueResult.stdout.toString().trim());
  console.log(`✓ Issue updated: ${issueUpdatedAt.toISOString()}`);
} catch (error) {
  console.log(`✗ Issue API failed: ${error.message}`);
}

// Test 2: Last comment (handle empty case)
try {
  const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  const comments = JSON.parse(commentsResult.stdout.toString().trim() || '[]');
  if (comments.length > 0) {
    const lastCommentTime = new Date(comments[comments.length - 1].created_at);
    console.log(`✓ Last comment: ${lastCommentTime.toISOString()}`);
  } else {
    console.log(`- No comments found`);
  }
} catch (error) {
  console.log(`✗ Comments API failed: ${error.message}`);
}

// Test 3: Recent PR
try {
  const prsResult = await $`gh pr list --repo ${owner}/${repo} --limit 1 --json createdAt`;
  const prs = JSON.parse(prsResult.stdout.toString().trim() || '[]');
  if (prs.length > 0) {
    const lastPrTime = new Date(prs[0].createdAt);
    console.log(`✓ Most recent PR: ${lastPrTime.toISOString()}`);
  } else {
    console.log(`- No PRs found`);
  }
} catch (error) {
  console.log(`✗ PR API failed: ${error.message}`);
}
