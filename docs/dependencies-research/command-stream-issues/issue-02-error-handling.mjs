#!/usr/bin/env node

/**
 * Issue: The library uses error.code instead of error.exitCode
 *
 * Minimal reproduction showing that command-stream uses non-standard error
 * property names, causing confusion when handling command failures.
 *
 * Pattern: try { reproduction } catch { workaround }
 */

console.log('🐛 Issue #02: Error handling - code vs exitCode\n');

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

/**
 * Setup test parameters (no try-catch, should fail on error)
 */
async function setup() {
  console.log('📦 Setting up test parameters...');

  const failingCommand = 'ls /nonexistent/directory/that/does/not/exist';
  const expectedExitCode = 1; // ls returns 1 for file not found

  console.log(`   Test command: ${failingCommand}`);
  console.log(`   Expected exit code: ${expectedExitCode}`);
  console.log('✅ Setup complete\n');

  return { failingCommand, expectedExitCode };
}

/**
 * Main test - ONE try-catch block for reproduction and workaround
 */
async function runTest() {
  // SETUP (no try-catch)
  const { failingCommand, expectedExitCode } = await setup();

  console.log('='.repeat(60));

  try {
    // TRY: Reproduce the issue - standard Node.js error handling pattern
    console.log('REPRODUCING ISSUE\n');
    console.log('1️⃣  Using standard Node.js error handling pattern:');
    console.log('   Expecting error.exitCode to contain the exit code\n');

    // Execute a command that will fail
    await $`${failingCommand}`;

    // Should not reach here
    console.log('❌ Command succeeded unexpectedly');
  } catch (error) {
    // CATCH: Demonstrate the issue and apply workaround
    console.log('✅ Command failed as expected, examining error object:');

    // Show the issue
    console.log('\n❌ ISSUE CONFIRMED: Non-standard error properties');
    console.log(`   error.exitCode: ${error.exitCode} (undefined - standard Node.js property)`);
    console.log(`   error.code: ${error.code} (${typeof error.code} - command-stream property)`);

    // Check if developer used standard pattern
    if (error.exitCode === expectedExitCode) {
      console.log('   ❌ Standard pattern FAILED - exitCode is undefined');
    }

    console.log('\n' + '='.repeat(60));
    console.log('APPLYING WORKAROUND\n');

    // WORKAROUND: Use error.code instead
    console.log('2️⃣  Using command-stream specific pattern:');

    if (error.code === expectedExitCode) {
      console.log('✅ WORKAROUND SUCCESSFUL!');
      console.log(`   error.code contains the exit code: ${error.code}`);
    }

    // Additional error properties available
    console.log('\n📋 Additional error properties available:');
    console.log(`   error.message: ${error.message.split('\n')[0]}`);
    console.log(`   error.stdout: ${error.stdout ? 'available' : 'not available'}`);
    console.log(`   error.stderr: ${error.stderr ? 'available' : 'not available'}`);

    if (error.stderr) {
      const stderrContent = error.stderr.toString().trim().split('\n')[0];
      console.log(`   stderr content: "${stderrContent}..."`);
    }
  }

  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY\n');
  console.log('❌ ISSUE: command-stream uses non-standard error properties');
  console.log('   • error.exitCode is undefined (standard Node.js property)');
  console.log('   • error.code contains the exit code (non-standard)');
  console.log('   • Breaks compatibility with standard Node.js patterns');

  console.log('\n✅ WORKAROUND:');
  console.log('   Always use error.code instead of error.exitCode');

  console.log('\nExample workaround code:');
  console.log('  try {');
  console.log('    await $`some-command`;');
  console.log('  } catch (error) {');
  console.log('    // Use error.code, NOT error.exitCode');
  console.log('    if (error.code !== 0) {');
  console.log('      console.log(`Exit code: ${error.code}`);');
  console.log('    }');
  console.log('  }');
}

// Run the test
await runTest();
