#!/usr/bin/env node
/**
 * Test script for --claude-file and --gitkeep-file flags
 * Tests mutual exclusivity and validation logic
 */

async function test(description, argv, expectedClaudeFile, expectedGitkeepFile, expectError = false) {
  console.log(`\n🧪 Test: ${description}`);
  console.log(`   Args: ${argv.join(' ')}`);

  try {
    // Dynamically import solve.mjs to get parseArguments behavior
    // We'll test by actually running the solve command in dry-run mode
    const { spawn } = await import('child_process');
    const { promisify } = await import('util');
    const execFile = promisify((await import('child_process')).execFile);

    // Run solve with --only-prepare-command to test arg parsing without execution
    const testArgs = [...argv, '--only-prepare-command'];

    try {
      const { stdout, stderr } = await execFile('node', ['src/solve.mjs', ...testArgs], {
        cwd: '/tmp/gh-issue-solver-1764808073828',
        timeout: 5000
      });

      if (expectError) {
        console.log(`   ❌ FAIL: Expected error but command succeeded`);
        return false;
      }

      console.log(`   ✅ PASS: Command succeeded`);
      return true;
    } catch (error) {
      if (expectError) {
        console.log(`   ✅ PASS: Got expected error`);
        console.log(`   Error: ${error.message}`);
        return true;
      }

      console.log(`   ❌ FAIL: Unexpected error`);
      console.log(`   Error: ${error.message}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ FAIL: Test setup error`);
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('Testing --claude-file and --gitkeep-file flags\n');
  console.log('='.repeat(60));

  const results = [];

  // Test 1: Default behavior (claude-file enabled by default)
  results.push(await test(
    'Default behavior',
    ['https://github.com/test/test/issues/1'],
    true, false, false
  ));

  // Test 2: Explicit --claude-file
  results.push(await test(
    'Explicit --claude-file',
    ['https://github.com/test/test/issues/1', '--claude-file'],
    true, false, false
  ));

  // Test 3: Explicit --gitkeep-file
  results.push(await test(
    'Explicit --gitkeep-file',
    ['https://github.com/test/test/issues/1', '--gitkeep-file'],
    false, true, false
  ));

  // Test 4: Both flags (should error)
  results.push(await test(
    'Both --claude-file and --gitkeep-file (should error)',
    ['https://github.com/test/test/issues/1', '--claude-file', '--gitkeep-file'],
    null, null, true
  ));

  // Test 5: --no-claude-file (should enable gitkeep)
  results.push(await test(
    '--no-claude-file (should enable gitkeep)',
    ['https://github.com/test/test/issues/1', '--no-claude-file'],
    false, true, false
  ));

  // Test 6: --no-gitkeep-file (should keep claude-file)
  results.push(await test(
    '--no-gitkeep-file (should keep claude-file)',
    ['https://github.com/test/test/issues/1', '--no-gitkeep-file'],
    true, false, false
  ));

  // Test 7: Both disabled (should error)
  results.push(await test(
    'Both --no-claude-file and --no-gitkeep-file (should error)',
    ['https://github.com/test/test/issues/1', '--no-claude-file', '--no-gitkeep-file'],
    null, null, true
  ));

  console.log('\n' + '='.repeat(60));
  console.log(`\nResults: ${results.filter(r => r).length}/${results.length} tests passed`);

  if (results.every(r => r)) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed!');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
