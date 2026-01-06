#!/usr/bin/env node
/**
 * Issue #8: getcwd() failed error
 *
 * Problem: "sh: 0: getcwd() failed: No such file or directory" when working in deleted directories
 * Solution: Ensure working directory exists before running commands
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = (await import('fs')).promises;
const path = (await import('path')).default;

console.log('=== Issue #8: getcwd() Failed Error ===\n');

console.log('Problem: Commands fail when current directory is deleted\n');

// Save current directory
const originalDir = process.cwd();

// Example 1: Demonstrate the problem
console.log('Example 1: Reproducing getcwd() error');

const tempDir = `/tmp/test-getcwd-${Date.now()}`;
try {
  // Create and enter temp directory
  await fs.mkdir(tempDir);
  process.chdir(tempDir);
  console.log(`Created and changed to: ${tempDir}`);

  // Verify we can run commands
  const result1 = await $`pwd`;
  console.log(`Current directory: ${result1.stdout.toString().trim()}`);

  // Now delete the directory while we're in it
  process.chdir('/tmp');
  await fs.rmdir(tempDir);
  console.log(`Deleted directory: ${tempDir}`);

  // Try to change back (this sets up the problem)
  try {
    process.chdir(tempDir);
  } catch (e) {
    console.log('Cannot chdir to deleted directory (expected)');
  }

  // Try to run a command - this may show getcwd error
  console.log('\nAttempting command in invalid directory state:');
  try {
    const result2 = await $`echo "test"`;
    console.log('Output:', result2.stdout.toString().trim());
  } catch (error) {
    console.log('Error:', error.message);
    if (error.stderr && error.stderr.toString().includes('getcwd')) {
      console.log('✓ getcwd() error detected!');
    }
  }
} catch (error) {
  console.log('Setup error:', error.message);
} finally {
  // Restore original directory
  process.chdir(originalDir);
}

console.log('\n' + '='.repeat(60) + '\n');

// Example 2: Common scenario - cleaning up temp directories
console.log('Example 2: Common scenario with temp directory cleanup');

const testDir = `/tmp/repo-test-${Date.now()}`;

try {
  // Simulate repository cloning and cleanup
  console.log('1. Creating temp directory for repo clone...');
  await fs.mkdir(testDir);

  console.log('2. Working in temp directory...');
  process.chdir(testDir);

  // Do some work
  await $`echo "Working in temp directory" > work.txt`;
  console.log('   Created work.txt');

  console.log('3. Cleaning up and returning to original directory...');
  process.chdir(originalDir);

  // Clean up temp directory
  await fs.rm(testDir, { recursive: true });
  console.log('   Temp directory removed');

  console.log('4. Running command after cleanup...');
  const result = await $`echo "Back in safe directory"`;
  console.log('   Success:', result.stdout.toString().trim());
} catch (error) {
  console.log('Error:', error.message);
  process.chdir(originalDir);
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution patterns
console.log('✅ SOLUTION PATTERNS:\n');

console.log('Pattern 1: Always return to safe directory before cleanup');
console.log(`const originalDir = process.cwd();
try {
  process.chdir(tempDir);
  // ... do work ...
} finally {
  process.chdir(originalDir);  // Return before cleanup
  await fs.rm(tempDir, { recursive: true });
}`);

console.log('\nPattern 2: Use absolute paths instead of chdir');
console.log(`// Instead of:
process.chdir(tempDir);
await $\`git init\`;

// Use:
await $\`cd \${tempDir} && git init\`;
// Or:
await $\`git -C \${tempDir} init\`;`);

console.log('\nPattern 3: Verify directory exists before commands');
console.log(`async function safeCommand(cmd) {
  try {
    // Check if current directory is valid
    await fs.access(process.cwd());
  } catch {
    // Change to safe directory
    process.chdir('/tmp');
  }
  return await $\`\${cmd}\`;
}`);

console.log('\n=== SUMMARY ===');
console.log('Problem: "getcwd() failed" when working directory is deleted');
console.log('Common Causes:');
console.log('  - Running commands after temp directory cleanup');
console.log('  - Deleting directory while still inside it');
console.log('  - Race conditions in async cleanup');
console.log('Prevention:');
console.log('  1. Always return to safe directory before cleanup');
console.log('  2. Use absolute paths in commands');
console.log('  3. Handle directory changes in try/finally blocks');
console.log('Note: This error is often harmless but indicates poor cleanup flow');
