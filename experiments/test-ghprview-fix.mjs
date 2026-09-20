#!/usr/bin/env node
// Experiment: Verify the ghPrView fix for issue #1549
// Tests that PR body content containing "Could not resolve" no longer causes false positive

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Import the fixed ghPrView
const { ghPrView, ghIssueView } = await import('../src/github.lib.mjs');

console.log('=== Test 1: ghPrView with PR that has "Could not resolve" in body ===');
const result = await ghPrView({
  prNumber: 170,
  owner: 'xlabtg',
  repo: 'teleton-agent',
  jsonFields: 'headRefName,body,number,mergeStateStatus,state,headRepositoryOwner,headRepository',
});

console.log('code:', result.code);
console.log('data is null:', result.data === null);
console.log('data.headRefName:', result.data?.headRefName);
console.log('data.number:', result.data?.number);
console.log('data.state:', result.data?.state);
console.log('data.headRepositoryOwner.login:', result.data?.headRepositoryOwner?.login);
console.log('data.headRepository.name:', result.data?.headRepository?.name);

if (result.data && result.data.headRefName === 'issue-163-5fb640dcc9d6') {
  console.log('\n✅ FIX VERIFIED: ghPrView correctly parses PR with "Could not resolve" in body');
} else {
  console.log('\n❌ FIX FAILED: ghPrView still returns null data');
  console.log('stderr:', result.stderr);
  console.log('stdout first 200:', result.stdout?.slice(0, 200));
}

console.log('\n=== Done ===');
