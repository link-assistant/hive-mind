#!/usr/bin/env node
/**
 * Command-Stream Issue #10: Git Push Silent Failure
 *
 * PROBLEM:
 * When using command-stream's $ to execute `git push`, the command appears to succeed
 * (returns code 0) but the push doesn't actually happen. The stdout is empty and no
 * data is transmitted to the remote repository.
 *
 * This is a critical issue that causes repository creation scripts to fail silently,
 * leaving repositories empty on GitHub while appearing to succeed locally.
 *
 * ROOT CAUSE:
 * Command-stream seems to interfere with git's authentication and I/O mechanisms,
 * possibly by intercepting or not properly forwarding the git credential helper
 * prompts or the actual data transfer.
 *
 * SYMPTOMS:
 * 1. `git push` returns exit code 0 (success)
 * 2. stdout is empty (no output like "To https://github.com/..." or "[new branch]")
 * 3. Remote repository remains empty
 * 4. No error messages are produced
 * 5. Local commits exist but aren't pushed
 *
 * AFFECTED COMMANDS:
 * - git push
 * - git push -u origin main
 * - Any git command that requires authentication and data transfer
 *
 * WORKAROUND:
 * Use Node.js child_process.execSync instead of command-stream for git push operations.
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import fs and child_process for testing
const fs = (await import('fs')).promises;
const { execSync } = await import('child_process');
const path = await import('path');
const os = await import('os');

console.log('Command-Stream Issue #10: Git Push Silent Failure\n');
console.log('='.repeat(60));

// Create a temporary test repository
async function createTestRepo() {
  const tempDir = path.join(os.tmpdir(), `test-git-push-${Date.now()}`);

  console.log('\n1. SETTING UP TEST REPOSITORY:');
  console.log('-'.repeat(40));
  console.log(`Creating temp directory: ${tempDir}`);

  await fs.mkdir(tempDir, { recursive: true });

  // Initialize git repo
  console.log('Initializing git repository...');
  const initResult = await $`cd ${tempDir} && git init`;
  if (initResult.code !== 0) {
    throw new Error('Failed to initialize git repository');
  }

  // Create a test file
  const testFile = path.join(tempDir, 'test.txt');
  await fs.writeFile(testFile, 'Test content for git push issue');
  console.log('Created test file: test.txt');

  // Set up git config (required for commit)
  await $`cd ${tempDir} && git config user.email "test@example.com"`;
  await $`cd ${tempDir} && git config user.name "Test User"`;

  // Add and commit
  console.log('Adding and committing test file...');
  const addResult = await $`cd ${tempDir} && git add test.txt`;
  if (addResult.code !== 0) {
    throw new Error('Failed to add file');
  }

  const commitResult = await $`cd ${tempDir} && git commit -m "Test commit"`;
  if (commitResult.code !== 0) {
    throw new Error('Failed to commit');
  }

  console.log('✅ Test repository created with one commit');

  return tempDir;
}

// Demonstrate the issue
async function demonstrateIssue(tempDir) {
  console.log('\n2. DEMONSTRATING THE PROBLEM:');
  console.log('-'.repeat(40));

  console.log('Attempting to push with command-stream $ (will fail silently)...\n');

  // This would normally require a real remote, but we can show the issue
  // by demonstrating that the output is empty even when trying to push
  console.log('Example code that would fail silently:');
  console.log('```javascript');
  console.log('// Add a remote (would need real GitHub repo)');
  console.log('await $`cd ${tempDir} && git remote add origin https://github.com/user/repo.git`;');
  console.log('');
  console.log('// Try to push - THIS FAILS SILENTLY');
  console.log('const pushResult = await $`cd ${tempDir} && git push -u origin main 2>&1`;');
  console.log('console.log("Exit code:", pushResult.code); // Shows: 0 (success!)');
  console.log('console.log("Output:", pushResult.stdout.toString()); // Shows: "" (empty!)');
  console.log('// But nothing was actually pushed!');
  console.log('```');

  // Demonstrate with a dry-run (doesn't need real remote)
  console.log('\nDemonstrating with --dry-run (no remote needed):');
  const dryRunResult = await $`cd ${tempDir} && git push --dry-run origin main 2>&1 || echo "Expected to fail without remote"`;
  console.log('Command-stream output for git push --dry-run:');
  console.log('  Exit code:', dryRunResult.code);
  console.log('  Stdout length:', dryRunResult.stdout.toString().length);
  console.log('  Stdout:', JSON.stringify(dryRunResult.stdout.toString()));

  // Show what git log says
  const logResult = await $`cd ${tempDir} && git log --oneline -n 1`;
  console.log('\nLocal commit exists:');
  console.log('  ', logResult.stdout.toString().trim());
}

// Show the workaround
async function showWorkaround(tempDir) {
  console.log('\n3. WORKAROUND WITH EXECSYNC:');
  console.log('-'.repeat(40));

  console.log('Using Node.js execSync instead:');
  console.log('```javascript');
  console.log('const { execSync } = await import("child_process");');
  console.log('try {');
  console.log('  const pushOutput = execSync("git push -u origin main 2>&1", {');
  console.log('    encoding: "utf8",');
  console.log('    cwd: tempDir');
  console.log('  });');
  console.log('  console.log("Push output:", pushOutput);');
  console.log('  // This WILL show the actual git push output');
  console.log('} catch (error) {');
  console.log('  console.error("Push failed:", error.message);');
  console.log('}');
  console.log('```');

  // Demonstrate execSync with dry-run
  console.log('\nDemonstrating execSync with --dry-run:');
  try {
    const output = execSync('git push --dry-run origin main 2>&1', {
      encoding: 'utf8',
      cwd: tempDir,
    });
    console.log('ExecSync output:', output);
  } catch (error) {
    // Expected to fail without remote, but we get the actual error message
    console.log('ExecSync properly captures error:');
    console.log('  ', error.message.split('\n')[0]);
  }
}

// Show real-world impact
async function showRealWorldImpact() {
  console.log('\n4. REAL-WORLD IMPACT:');
  console.log('-'.repeat(40));

  console.log('This issue was discovered in create-test-repo.mjs where:');
  console.log('- Repository creation appeared successful');
  console.log('- Local commits were created properly');
  console.log('- Git push returned success (code 0)');
  console.log('- But GitHub repository remained empty');
  console.log('- No error messages to help debug');

  console.log('\nThis causes:');
  console.log('- Silent failures in CI/CD pipelines');
  console.log('- Empty repositories despite "successful" creation');
  console.log('- Confusion when subsequent operations fail');
  console.log('- Time wasted debugging non-obvious failures');
}

// Clean up
async function cleanup(tempDir) {
  console.log('\n5. CLEANING UP:');
  console.log('-'.repeat(40));
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('✅ Cleaned up test repository');
  } catch (error) {
    console.log('⚠️  Could not clean up:', error.message);
  }
}

// Main execution
async function main() {
  let tempDir;
  try {
    tempDir = await createTestRepo();
    await demonstrateIssue(tempDir);
    await showWorkaround(tempDir);
    await showRealWorldImpact();
  } catch (error) {
    console.error('\n❌ Error during demonstration:', error.message);
  } finally {
    if (tempDir) {
      await cleanup(tempDir);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDATION: Always use execSync for git push operations');
  console.log('until this command-stream issue is resolved.');
  console.log('='.repeat(60));
}

// Run the demonstration
main().catch(console.error);
