#!/usr/bin/env node

/**
 * Command-Stream Issue #14: CWD with CD Pattern Failure
 *
 * PROBLEM:
 * When using command-stream's $ with the pattern `cd ${dir} && command`, the commands
 * don't actually execute in the specified directory. The cd command appears to succeed
 * (returns code 0) but subsequent commands in the chain don't run in that directory.
 *
 * This causes critical failures in git operations where files appear to be added and
 * committed successfully, but are actually not staged or committed at all.
 *
 * ROOT CAUSE:
 * The shell spawned by command-stream for each $ invocation doesn't persist the
 * directory change from `cd`. Each command in the chain might be executed in a
 * separate shell context, or the cd might not affect the subsequent commands.
 *
 * SYMPTOMS:
 * 1. `git add` returns success but files remain untracked
 * 2. `git commit` returns success but no commit is created
 * 3. `git status` shows files as untracked after "successful" add
 * 4. `git log` shows no new commits after "successful" commit
 * 5. All commands return exit code 0 (success)
 *
 * AFFECTED PATTERNS:
 * - $`cd ${tempDir} && git add file`
 * - $`cd ${tempDir} && git commit -m "message"`
 * - Any command using cd && pattern
 *
 * WORKAROUND:
 * Use the cwd option explicitly: $({ cwd: tempDir })`command`
 * This properly sets the working directory for the command execution.
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import required modules
const fs = (await import('fs')).promises;
const path = await import('path');
const os = await import('os');
const { execSync } = await import('child_process');

console.log('Command-Stream Issue #14: CWD with CD Pattern Failure\n');
console.log('='.repeat(60));

/**
 * Test 1: Demonstrate the problem with cd pattern
 */
async function demonstrateProblem() {
  console.log('\n📍 Test 1: Problem with cd && pattern\n');

  // Create a temporary directory and file
  const tempDir = path.join(os.tmpdir(), `test-cwd-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const testFile = path.join(tempDir, 'test.txt');
  await fs.writeFile(testFile, 'Test content');

  console.log(`   Temp directory: ${tempDir}`);
  console.log(`   Test file: test.txt`);

  // Initialize git repo
  await $({ cwd: tempDir })`git init`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;

  console.log('\n   ❌ Attempting with cd pattern (FAILS):');

  try {
    // This pattern FAILS - file won't actually be added
    const addResult = await $`cd ${tempDir} && git add test.txt`;
    console.log(`      git add exit code: ${addResult.code}`);

    // Check if file was actually added
    const statusResult = await $({ cwd: tempDir })`git status --short`;
    const status = statusResult.stdout.toString().trim();

    if (status.includes('??')) {
      console.log(`      ⚠️  File still untracked: ${status}`);
      console.log('      ❌ git add FAILED despite returning success!');
    } else {
      console.log(`      Status: ${status}`);
    }

    // Try to commit (will also fail silently)
    const commitResult = await $`cd ${tempDir} && git commit -m "Test commit"`;
    console.log(`      git commit exit code: ${commitResult.code}`);

    // Check if commit was created
    const logResult = await $({ cwd: tempDir })`git log --oneline 2>&1`;
    const log = logResult.stdout.toString().trim();

    if (log.includes('does not have any commits') || !log) {
      console.log('      ❌ No commit created despite "success"!');
    } else {
      console.log(`      Commits: ${log.split('\\n').length}`);
    }
  } catch (error) {
    console.log(`      Error: ${error.message}`);
  }

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
}

/**
 * Test 2: Show the working solution with cwd option
 */
async function demonstrateSolution() {
  console.log('\n📍 Test 2: Solution with cwd option\n');

  // Create a temporary directory and file
  const tempDir = path.join(os.tmpdir(), `test-cwd-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const testFile = path.join(tempDir, 'test.txt');
  await fs.writeFile(testFile, 'Test content');

  console.log(`   Temp directory: ${tempDir}`);
  console.log(`   Test file: test.txt`);

  // Initialize git repo
  await $({ cwd: tempDir })`git init`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;

  console.log('\n   ✅ Using cwd option (WORKS):');

  try {
    // This pattern WORKS - file will be properly added
    const addResult = await $({ cwd: tempDir })`git add test.txt`;
    console.log(`      git add exit code: ${addResult.code}`);

    // Check if file was actually added
    const statusResult = await $({ cwd: tempDir })`git status --short`;
    const status = statusResult.stdout.toString().trim();
    console.log(`      Status: ${status}`);

    if (status.includes('A ')) {
      console.log('      ✅ File successfully staged!');
    }

    // Commit the file
    const commitResult = await $({ cwd: tempDir })`git commit -m "Test commit"`;
    console.log(`      git commit exit code: ${commitResult.code}`);

    // Check if commit was created
    const logResult = await $({ cwd: tempDir })`git log --oneline`;
    const log = logResult.stdout.toString().trim();

    if (log && !log.includes('does not have any commits')) {
      console.log(`      ✅ Commit created: ${log.split('\\n')[0]}`);
    }
  } catch (error) {
    console.log(`      Error: ${error.message}`);
  }

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
}

/**
 * Test 3: Compare both patterns side by side
 */
async function comparePatterns() {
  console.log('\n📍 Test 3: Direct comparison\n');

  const tempDir = path.join(os.tmpdir(), `test-cwd-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Create two test files
  await fs.writeFile(path.join(tempDir, 'file1.txt'), 'Content 1');
  await fs.writeFile(path.join(tempDir, 'file2.txt'), 'Content 2');

  // Initialize repo
  await $({ cwd: tempDir })`git init`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;

  console.log('   Pattern comparison:\n');
  console.log('   ❌ cd && pattern:');

  // Try with cd pattern
  const cdAddResult = await $`cd ${tempDir} && git add file1.txt 2>&1`;
  const cdStatus = await $({ cwd: tempDir })`git status --short file1.txt`;
  console.log(`      Result: ${cdStatus.stdout.toString().trim() || 'File NOT staged'}`);

  console.log('\n   ✅ cwd option:');

  // Try with cwd option
  const cwdAddResult = await $({ cwd: tempDir })`git add file2.txt 2>&1`;
  const cwdStatus = await $({ cwd: tempDir })`git status --short file2.txt`;
  console.log(`      Result: ${cwdStatus.stdout.toString().trim() || 'File NOT staged'}`);

  // Show final status
  console.log('\n   Final repository status:');
  const finalStatus = await $({ cwd: tempDir })`git status --short`;
  console.log(
    finalStatus.stdout
      .toString()
      .split('\\n')
      .map(line => `      ${line}`)
      .join('\\n')
  );

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
}

/**
 * Main execution
 */
async function main() {
  try {
    await demonstrateProblem();
    await demonstrateSolution();
    await comparePatterns();

    console.log('\n' + '='.repeat(60));
    console.log('\n📝 SUMMARY:\n');
    console.log("   PROBLEM:  $`cd ${dir} && command` doesn't work");
    console.log('   SOLUTION: $({ cwd: dir })`command`');
    console.log('\n   Always use the cwd option for directory-specific commands!');
    console.log('\n' + '='.repeat(60));
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the tests
main().catch(console.error);
