#!/usr/bin/env node

// Test script to understand what error message GitHub CLI returns when trying to create an existing fork

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Test what happens when we try to fork a repo that's already forked
// We'll use a known public repo for testing

const testRepo = 'octocat/Hello-World';

console.log('Testing fork creation error handling...');

// First check if we already have this fork
try {
  const currentUser = await $`gh api user --jq .login`;
  const username = currentUser.stdout.toString().trim();
  console.log(`Current user: ${username}`);

  // Check if fork exists
  const forkCheck = await $`gh repo view ${username}/Hello-World --json name 2>/dev/null`;

  if (forkCheck.code === 0) {
    console.log('Fork already exists. Testing duplicate creation...');

    // Try to create fork again
    try {
      const forkResult = await $`gh repo fork ${testRepo} --clone=false`;
      console.log('Unexpected: Fork creation succeeded when it should have failed');
      console.log('stdout:', forkResult.stdout.toString());
    } catch (error) {
      console.log('Fork creation failed as expected:');
      console.log('exit code:', error.exitCode);
      console.log('stderr:', error.stderr);
      console.log('stdout:', error.stdout);
    }
  } else {
    console.log("Fork doesn't exist. Creating one for testing...");

    try {
      const forkResult = await $`gh repo fork ${testRepo} --clone=false`;
      console.log('Fork created successfully:');
      console.log('stdout:', forkResult.stdout.toString());

      // Now try to create it again
      console.log('Now testing duplicate creation...');
      try {
        const dupeForkResult = await $`gh repo fork ${testRepo} --clone=false`;
        console.log('Unexpected: Duplicate fork creation succeeded');
        console.log('stdout:', dupeForkResult.stdout.toString());
      } catch (error) {
        console.log('Duplicate fork creation failed as expected:');
        console.log('exit code:', error.exitCode);
        console.log('stderr:', error.stderr);
        console.log('stdout:', error.stdout);
      }
    } catch (error) {
      console.log('Initial fork creation failed:');
      console.log('exit code:', error.exitCode);
      console.log('stderr:', error.stderr);
      console.log('stdout:', error.stdout);
    }
  }
} catch (error) {
  console.log('Error getting current user:', error);
}
