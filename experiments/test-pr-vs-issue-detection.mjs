#!/usr/bin/env node

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;
const { $ } = await use('command-stream');

const owner = 'link-assistant';
const repo = 'hive-mind';
const number = 320;

console.log(`\nTesting PR vs Issue detection for #${number} in ${owner}/${repo}\n`);

console.log('1. Try to fetch as PR:');
const prResult = await $`gh pr view ${number} --repo ${owner}/${repo} --json number,title`;
const prOutput = prResult.stdout.toString() + (prResult.stderr ? prResult.stderr.toString() : '');

if (prResult.code === 0 && !prOutput.includes('Could not resolve to a PullRequest')) {
  console.log("   ✅ It's a PR!");
  console.log('   Data:', prOutput);
} else {
  console.log('   ❌ Not a PR (or PR does not exist)');
  if (prOutput.includes('Could not resolve to a PullRequest')) {
    console.log('   Error: GraphQL error - PR does not exist');
  } else if (prResult.stderr) {
    console.log('   Error:', prResult.stderr.toString());
  }

  console.log('\n2. Try to fetch as Issue:');
  const issueResult = await $`gh issue view ${number} --repo ${owner}/${repo} --json number,title`;
  const issueOutput = issueResult.stdout.toString();

  if (issueResult.code === 0 && !issueOutput.includes('Could not resolve')) {
    console.log("   ✅ It's an Issue!");
    const issueData = JSON.parse(issueOutput);
    console.log('   Title:', issueData.title);
    console.log('\n3. User-friendly error message:');
    console.log('   ─────────────────────────────────────────────────────────');
    console.log(`   ❌ Error: PR #${number} does not exist in ${owner}/${repo}`);
    console.log('');
    console.log(`   💡 However, Issue #${number} exists with the same number.`);
    console.log(`      Title: "${issueData.title}"`);
    console.log('');
    console.log('   🔧 Did you mean to work on the issue instead?');
    console.log('      Try this corrected command:');
    console.log('');
    console.log(`      solve https://github.com/${owner}/${repo}/issues/${number} --auto-continue --attach-logs --verbose --model opus --think max`);
    console.log('');
    console.log('   ─────────────────────────────────────────────────────────');
  } else {
    console.log('   ❌ Not an Issue either');
    console.log('   The number does not exist as either a PR or Issue.');
  }
}
