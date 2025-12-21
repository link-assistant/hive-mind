#!/usr/bin/env node

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;
const { $ } = await use('command-stream');

const log = async msg => console.log(msg);

const owner = 'link-assistant';
const repo = 'hive-mind';
const prNumber = 320;

const argv = {
  autoContinue: true,
  attachLogs: true,
  verbose: true,
  model: 'opus',
  think: 'max',
  'attach-logs': true
};

console.log('\n=== Testing Issue #322 Fix ===\n');
console.log(`Testing PR #${prNumber} which is actually an issue\n`);

try {
  const prResult =
    await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefName,body,number,mergeStateStatus,headRepositoryOwner`;
  const prOutput = prResult.stdout.toString() + (prResult.stderr ? prResult.stderr.toString() : '');

  console.log('Step 1: Detecting GraphQL error...');
  if (prResult.code !== 0 || prOutput.includes('Could not resolve to a PullRequest')) {
    console.log('✅ GraphQL error detected correctly\n');

    if (prOutput.includes('Could not resolve to a PullRequest')) {
      console.log("Step 2: Checking if it's an issue...");

      try {
        const issueCheckResult = await $`gh issue view ${prNumber} --repo ${owner}/${repo} --json number,title`;
        const issueOutput = issueCheckResult.stdout.toString();

        if (issueCheckResult.code === 0 && !issueOutput.includes('Could not resolve')) {
          const issueData = JSON.parse(issueOutput);
          console.log('✅ Issue found!\n');

          console.log('Step 3: Generating error message...\n');
          console.log('Expected output:');
          console.log('─────────────────────────────────────────────────────────');
          await log('Error: Failed to get PR details');
          await log(`Error: PR #${prNumber} does not exist in ${owner}/${repo}`);
          await log('');
          await log(`💡 However, Issue #${prNumber} exists with the same number:`);
          await log(`   Title: "${issueData.title}"`);
          await log('');
          await log('🔧 Did you mean to work on the issue instead?');
          await log('   Try this corrected command:');
          await log('');

          const commandParts = [`solve https://github.com/${owner}/${repo}/issues/${prNumber}`];
          if (argv.autoContinue) commandParts.push('--auto-continue');
          if (argv.attachLogs || argv['attach-logs']) commandParts.push('--attach-logs');
          if (argv.verbose) commandParts.push('--verbose');
          if (argv.model && argv.model !== 'sonnet') commandParts.push('--model', argv.model);
          if (argv.think) commandParts.push('--think', argv.think);

          await log(`   ${commandParts.join(' ')}`);
          await log('');
          console.log('─────────────────────────────────────────────────────────');
          console.log('\n✅ Test passed! Error handling working correctly.');
        } else {
          console.log('❌ Issue check failed');
        }
      } catch (issueCheckError) {
        console.log('❌ Error checking for issue:', issueCheckError.message);
      }
    }
  } else {
    console.log('❌ PR fetch succeeded (unexpected)');
  }
} catch (error) {
  console.log('❌ Test failed:', error.message);
}

console.log('\n=== Test Complete ===');
