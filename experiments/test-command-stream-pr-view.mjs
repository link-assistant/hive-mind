#!/usr/bin/env node
// Experiment: Reproduce the "Failed to get PR details" issue
// This tests whether command-stream's $ correctly captures gh pr view output

// Dynamic import of command-stream (same as solve.mjs uses)
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

const prNumber = 170;
const owner = 'xlabtg';
const repo = 'teleton-agent';
const jsonFields = 'headRefName,body,number,mergeStateStatus,state,headRepositoryOwner,headRepository';

console.log('=== Test 1: Direct gh command ===');
try {
  const result = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json ${jsonFields}`;
  console.log('\n--- Result properties ---');
  console.log('code:', result.code);
  console.log('typeof stdout:', typeof result.stdout);
  console.log('stdout length:', result.stdout?.length);
  console.log('stdout first 200 chars:', result.stdout?.slice(0, 200));
  console.log('stderr:', result.stderr);

  // Now try to parse like ghPrView does
  const stdout = result.stdout.toString();
  const stderr = result.stderr ? result.stderr.toString() : '';
  const code = result.code || 0;
  console.log('\n--- After .toString() ---');
  console.log('code:', code);
  console.log('stdout length:', stdout.length);
  console.log('stdout first 200 chars:', stdout.slice(0, 200));

  let data = null;
  if (code === 0 && stdout && !stdout.includes('Could not resolve')) {
    try {
      data = JSON.parse(stdout);
      console.log('\n--- JSON parsed successfully ---');
      console.log('headRefName:', data.headRefName);
      console.log('number:', data.number);
      console.log('state:', data.state);
    } catch (e) {
      console.log('\n--- JSON parse failed ---');
      console.log('Error:', e.message);
      console.log('First 500 chars of stdout:', stdout.slice(0, 500));
    }
  } else {
    console.log('\n--- Would trigger "Failed to get PR details" ---');
    console.log('code !== 0:', code !== 0);
    console.log('!stdout:', !stdout);
    console.log('includes "Could not resolve":', stdout.includes('Could not resolve'));
    console.log('!data:', !data);
  }
} catch (error) {
  console.log('\n--- Exception caught ---');
  console.log('Error:', error.message);
  console.log('Error code:', error.code);
  console.log('Error stdout:', error.stdout?.toString()?.slice(0, 200));
  console.log('Error stderr:', error.stderr?.toString()?.slice(0, 200));
}

console.log('\n=== Test 2: Same command with mirror:false ===');
try {
  const result = await $({ mirror: false })`gh pr view ${prNumber} --repo ${owner}/${repo} --json ${jsonFields}`;
  console.log('code:', result.code);
  console.log('typeof stdout:', typeof result.stdout);
  console.log('stdout length:', result.stdout?.length);
  console.log('stdout first 200:', result.stdout?.slice(0, 200));

  let data = null;
  const stdout = result.stdout?.toString() || '';
  if (result.code === 0 && stdout) {
    try {
      data = JSON.parse(stdout);
      console.log('JSON parsed OK, headRefName:', data.headRefName);
    } catch (e) {
      console.log('JSON parse failed:', e.message);
    }
  }
} catch (error) {
  console.log('Exception:', error.message);
}

console.log('\n=== Done ===');
