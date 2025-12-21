#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function cleanupScreenSession(sessionName) {
  try {
    await execAsync(`screen -S ${sessionName} -X quit`);
  } catch (error) {}
}

async function screenSessionExists(sessionName) {
  try {
    const { stdout } = await execAsync('screen -ls');
    return stdout.includes(sessionName);
  } catch (error) {
    return false;
  }
}

async function testSessionReuse() {
  const testSessionName = 'solve-test-repo-1';

  console.log('='.repeat(70));
  console.log('Testing screen session reuse behavior');
  console.log('='.repeat(70));
  console.log();

  try {
    await cleanupScreenSession(testSessionName);

    console.log('Step 1: Creating a dummy screen session...');
    await execAsync(`screen -dmS ${testSessionName} bash -c 'echo "Test session"; exec bash'`);

    const exists1 = await screenSessionExists(testSessionName);
    console.log(`  Session exists: ${exists1 ? '✓ YES' : '✗ NO'}`);

    if (!exists1) {
      console.log('✗ FAILED: Could not create initial session');
      process.exit(1);
    }

    console.log();
    console.log('Step 2: Running start-screen with the same session name...');
    console.log(`  Command: ./start-screen.mjs solve https://github.com/test/repo/issues/1`);
    console.log();

    const { stdout } = await execAsync(`./start-screen.mjs solve https://github.com/test/repo/issues/1`, {
      cwd: '/tmp/gh-issue-solver-1759308672555'
    });

    console.log('Output from start-screen:');
    console.log(stdout);

    console.log('Step 3: Checking for duplicate sessions...');
    const { stdout: screenList } = await execAsync('screen -ls');
    const sessionMatches = screenList.match(new RegExp(testSessionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    const count = sessionMatches ? sessionMatches.length : 0;

    console.log(`  Sessions found with name pattern: ${count}`);

    if (count > 1) {
      console.log('  Screen list output:');
      console.log(screenList);
      console.log();
      console.log('✗ FAILED: Multiple sessions with same name created');
      await cleanupScreenSession(testSessionName);
      process.exit(1);
    }

    console.log();
    console.log('Step 4: Verifying output messages...');
    const hasAlreadyExists = stdout.includes('already exists');
    const hasReusing = stdout.includes('Reusing existing session');
    const hasNoNewSession = !stdout.includes('Creating screen session');

    console.log(`  Has "already exists" message: ${hasAlreadyExists ? '✓ YES' : '✗ NO'}`);
    console.log(`  Has "Reusing existing session" message: ${hasReusing ? '✓ YES' : '✗ NO'}`);
    console.log(`  Does NOT create new session: ${hasNoNewSession ? '✓ YES' : '✗ NO'}`);

    const allChecks = hasAlreadyExists && hasReusing && hasNoNewSession;

    console.log();
    console.log('='.repeat(70));
    if (allChecks && count === 1) {
      console.log('✓ All tests PASSED!');
      console.log('  - No duplicate sessions created');
      console.log('  - Correct messages displayed');
      await cleanupScreenSession(testSessionName);
      process.exit(0);
    } else {
      console.log('✗ Some tests FAILED!');
      await cleanupScreenSession(testSessionName);
      process.exit(1);
    }
  } catch (error) {
    console.error('Test error:', error.message);
    await cleanupScreenSession(testSessionName);
    process.exit(1);
  }
}

testSessionReuse();
