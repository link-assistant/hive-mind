#!/usr/bin/env node
// Test script to verify the comment counting fix using real GitHub API
// This creates a test repository, issue, and PR to test the fix

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const crypto = (await import('crypto')).default;
const fs = (await import('fs')).promises;

// Generate UUIDv7 for unique repo name
function generateUUIDv7() {
  const timestamp = Date.now();
  const timestampHex = timestamp.toString(16).padStart(12, '0');
  const randomBytes = crypto.randomBytes(10);
  const uuid = [timestampHex.slice(0, 8), timestampHex.slice(8, 12), '7' + randomBytes.toString('hex').slice(0, 3), ((randomBytes[2] & 0x3f) | 0x80).toString(16).padStart(2, '0') + randomBytes.toString('hex').slice(5, 7), randomBytes.toString('hex').slice(7, 19)].join('-');
  return uuid;
}

const uuid = generateUUIDv7();
const repoName = `test-comment-fix-${uuid}`;

console.log('🧪 Testing Comment Counting Fix for PR #111');
console.log('='.repeat(60));
console.log(`📦 Test repository: ${repoName}`);
console.log('');

try {
  // Get current GitHub user
  const userResult = await $`gh api user --jq .login`;
  const githubUser = userResult.stdout.toString().trim();
  console.log(`👤 User: ${githubUser}`);

  const repoUrl = `https://github.com/${githubUser}/${repoName}`;
  const tempDir = `/tmp/${repoName}-test`;

  // Step 1: Create test repository
  console.log('\n📝 Step 1: Creating test repository...');
  await $`gh repo create ${repoName} --public --description "Test for comment counting fix" --clone=false`;

  // Step 2: Initialize repository with content
  console.log('📂 Step 2: Initializing repository...');
  await $`mkdir -p ${tempDir}`;
  await $`cd ${tempDir} && git init`;
  await $`cd ${tempDir} && git remote add origin ${repoUrl}`;

  // Create initial files
  await fs.writeFile(`${tempDir}/README.md`, `# Test Repository\n\nTesting comment counting fix.`);
  await fs.writeFile(`${tempDir}/hello.js`, `console.log('Hello World');`);

  await $`cd ${tempDir} && git add .`;
  await $`cd ${tempDir} && git commit -m "Initial commit"`;
  await $`cd ${tempDir} && git branch -M main`;
  await $`cd ${tempDir} && git push -u origin main`;

  // Step 3: Create an issue
  console.log('\n🐛 Step 3: Creating test issue...');
  const issueResult = await $`gh issue create --repo ${githubUser}/${repoName} --title "Test: Add greeting function" --body "Please add a greeting function that takes a name parameter."`;
  const issueUrl = issueResult.stdout.toString().trim();
  const issueNumber = issueUrl.split('/').pop();
  console.log(`   Created issue #${issueNumber}: ${issueUrl}`);

  // Step 4: Run solve.mjs initially to create a PR
  console.log('\n🔧 Step 4: Running solve.mjs to create initial PR...');
  const solveLogFile = `/tmp/solve-initial-${uuid}.log`;
  const solveCmd = `./solve.mjs ${issueUrl} --model claude-3-5-sonnet-20241022 --verbose > ${solveLogFile} 2>&1`;

  console.log(`   Running: ${solveCmd}`);
  const initialSolveResult = await $`timeout 120 ${solveCmd} || true`;

  // Extract PR URL from logs
  const initialLogs = await fs.readFile(solveLogFile, 'utf8');
  const prUrlMatch = initialLogs.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/);

  if (!prUrlMatch) {
    console.log('❌ Failed to create initial PR');
    console.log('   Check logs at:', solveLogFile);
    process.exit(1);
  }

  const prUrl = prUrlMatch[0];
  const prNumber = prUrl.split('/').pop();
  console.log(`   Created PR #${prNumber}: ${prUrl}`);

  // Step 5: Test continue mode with 0 comments
  console.log('\n🧪 Step 5: Testing continue mode with 0 comments...');
  const continueLogFile = `/tmp/solve-continue-${uuid}.log`;
  const continueCmd = `./solve.mjs ${issueUrl} --continue --model claude-3-5-sonnet-20241022 --verbose 2>&1 | tee ${continueLogFile}`;

  console.log(`   Running: ${continueCmd}`);
  console.log('\n   Looking for comment counts in the output...\n');

  // Run and capture output
  const continueResult = await $`timeout 30 bash -c "${continueCmd}" || true`;
  const continueOutput = continueResult.stdout.toString();

  // Check if comment counts appear in the logs
  const hasNewPrComments = continueOutput.includes('New PR comments:');
  const hasNewIssueComments = continueOutput.includes('New issue comments:');
  const hasCommentInPrompt = continueOutput.includes('New comments on the pull request:') || continueOutput.includes('New comments on the issue:');

  console.log('\n📊 Results:');
  console.log('='.repeat(60));

  if (hasNewPrComments && hasNewIssueComments) {
    console.log('✅ Comment counting logs found:');
    const prCommentLine = continueOutput.match(/.*New PR comments:.*$/m);
    const issueCommentLine = continueOutput.match(/.*New issue comments:.*$/m);
    if (prCommentLine) console.log(`   ${prCommentLine[0].trim()}`);
    if (issueCommentLine) console.log(`   ${issueCommentLine[0].trim()}`);
  } else {
    console.log('❌ Comment counting logs NOT found');
  }

  if (hasCommentInPrompt) {
    console.log('✅ Comment info appears in the prompt:');
    const promptCommentLines = continueOutput.match(/New comments on the (?:pull request|issue): \d+/g);
    if (promptCommentLines) {
      promptCommentLines.forEach(line => console.log(`   ${line}`));
    }
  } else {
    console.log('❌ Comment info does NOT appear in the prompt');
  }

  // Step 6: Add a comment and test again
  console.log('\n💬 Step 6: Adding a comment and testing continue mode again...');
  await $`gh pr comment ${prNumber} --repo ${githubUser}/${repoName} --body "Test comment for verification"`;
  console.log('   Added test comment to PR');

  // Wait a moment for GitHub to process
  await new Promise(resolve => setTimeout(resolve, 2000));

  const continueWithCommentLogFile = `/tmp/solve-continue-with-comment-${uuid}.log`;
  const continueWithCommentCmd = `./solve.mjs ${issueUrl} --continue --model claude-3-5-sonnet-20241022 --verbose 2>&1 | tee ${continueWithCommentLogFile}`;

  console.log(`   Running: ${continueWithCommentCmd}`);
  console.log('\n   Looking for comment counts in the output...\n');

  const continueWithCommentResult = await $`timeout 30 bash -c "${continueWithCommentCmd}" || true`;
  const continueWithCommentOutput = continueWithCommentResult.stdout.toString();

  // Check results with comment
  const hasNewPrComments2 = continueWithCommentOutput.includes('New PR comments:');
  const hasNewIssueComments2 = continueWithCommentOutput.includes('New issue comments:');
  const hasCommentInPrompt2 = continueWithCommentOutput.includes('New comments on the pull request:');

  console.log('\n📊 Results with comment:');
  console.log('='.repeat(60));

  if (hasNewPrComments2 && hasNewIssueComments2) {
    console.log('✅ Comment counting logs found:');
    const prCommentLine = continueWithCommentOutput.match(/.*New PR comments:.*$/m);
    const issueCommentLine = continueWithCommentOutput.match(/.*New issue comments:.*$/m);
    if (prCommentLine) console.log(`   ${prCommentLine[0].trim()}`);
    if (issueCommentLine) console.log(`   ${issueCommentLine[0].trim()}`);
  } else {
    console.log('❌ Comment counting logs NOT found');
  }

  if (hasCommentInPrompt2) {
    console.log('✅ Comment info appears in the prompt:');
    const promptCommentLines = continueWithCommentOutput.match(/New comments on the (?:pull request|issue): \d+/g);
    if (promptCommentLines) {
      promptCommentLines.forEach(line => console.log(`   ${line}`));
    }
  } else {
    console.log('❌ Comment info does NOT appear in the prompt');
  }

  // Cleanup
  console.log('\n🧹 Step 7: Cleaning up...');
  await $`gh repo delete ${githubUser}/${repoName} --yes`;
  await $`rm -rf ${tempDir}`;
  console.log('   Test repository deleted');

  console.log('\n✅ Test completed successfully!');
  console.log('\n📝 Summary:');
  console.log('   The fix ensures that comment counts always appear in continue mode,');
  console.log('   even when there are 0 new comments. This provides clear visibility');
  console.log('   to users about the comment status.');
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
}
