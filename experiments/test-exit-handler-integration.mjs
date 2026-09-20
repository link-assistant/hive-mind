#!/usr/bin/env node

/**
 * Integration test to verify that exit handler displays the correct log path
 * even after the log file has been renamed (e.g., when session ID is obtained)
 *
 * This test creates a temporary file, simulates the log rename process,
 * and verifies the exit handler behavior.
 */

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';

async function runTest() {
  console.log('\n🧪 Testing exit handler with log file rename...\n');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-exit-'));
  const testScript = path.join(tempDir, 'test-exit.mjs');

  try {
    // Create a test script that simulates the actual flow
    const testCode = `#!/usr/bin/env node

// Set up globalThis.use for the test environment
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.use = (module) => {
  return Promise.resolve(require(module));
};

// Import required modules
const lib = await import('${path.resolve('./src/lib.mjs')}');
const { log, setLogFile, getAbsoluteLogPath } = lib;
const exitHandler = await import('${path.resolve('./src/exit-handler.lib.mjs')}');
const { initializeExitHandler, installGlobalExitHandlers, safeExit } = exitHandler;

const fs = (await use('fs')).promises;
const path = (await use('path'));

// Create initial log file
const tempDir = '${tempDir}';
const initialLogFile = path.join(tempDir, 'initial.log');
await fs.writeFile(initialLogFile, 'Initial log content\\n');
setLogFile(initialLogFile);

console.log('📁 Initial log file: ' + initialLogFile);

// Initialize exit handler with getAbsoluteLogPath function
initializeExitHandler(getAbsoluteLogPath, log);

// Verify initial state
const initialPath = await getAbsoluteLogPath();
console.log('✅ Exit handler initialized');
console.log('   Current log path: ' + initialPath);

// Simulate getting a session ID and renaming the log file
const sessionId = 'test-session-123456';
const renamedLogFile = path.join(tempDir, sessionId + '.log');

console.log('\\n📝 Simulating session ID obtained: ' + sessionId);
console.log('   Renaming log file to: ' + renamedLogFile);

// Rename the file
await fs.rename(initialLogFile, renamedLogFile);

// Update the log file reference (as done in solve.claude-execution.lib.mjs)
setLogFile(renamedLogFile);

// Verify the log path has changed
const renamedPath = await getAbsoluteLogPath();
console.log('✅ Log file renamed successfully');
console.log('   New log path: ' + renamedPath);

// Test that the exit handler will use the new path
if (renamedPath === renamedLogFile) {
  console.log('\\n✅ TEST PASSED: Exit handler will show the correct renamed log path');
  console.log('EXPECTED_PATH:' + renamedLogFile);
  process.exit(0);
} else {
  console.log('\\n❌ TEST FAILED: Path mismatch');
  console.log('   Expected: ' + renamedLogFile);
  console.log('   Got: ' + renamedPath);
  process.exit(1);
}
`;

    await fs.writeFile(testScript, testCode);
    await fs.chmod(testScript, '755');

    // Run the test script and capture output
    const output = execSync(`node ${testScript}`, { encoding: 'utf8' });
    console.log(output);

    // Extract the expected path from the output
    const expectedPathMatch = output.match(/EXPECTED_PATH:(.+)/);
    if (expectedPathMatch) {
      const expectedPath = expectedPathMatch[1];

      // Now test that exit messages would show the correct path
      const exitTestScript = path.join(tempDir, 'test-exit-message.mjs');
      const exitTestCode = `#!/usr/bin/env node

// Set up globalThis.use for the test environment
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.use = (module) => {
  return Promise.resolve(require(module));
};

const lib = await import('${path.resolve('./src/lib.mjs')}');
const { log, setLogFile, getAbsoluteLogPath } = lib;
const exitHandler = await import('${path.resolve('./src/exit-handler.lib.mjs')}');
const { initializeExitHandler, safeExit } = exitHandler;

// Set the renamed log file
setLogFile('${expectedPath}');

// Initialize exit handler with getAbsoluteLogPath function
initializeExitHandler(getAbsoluteLogPath, log);

// Trigger exit with message
await safeExit(0, 'Test completed successfully');
`;

      await fs.writeFile(exitTestScript, exitTestCode);
      await fs.chmod(exitTestScript, '755');

      console.log('\n📝 Testing exit message output...\n');
      const exitOutput = execSync(`node ${exitTestScript} 2>&1`, { encoding: 'utf8' });

      if (exitOutput.includes(expectedPath)) {
        console.log('✅ Exit message shows correct renamed log path!');
        console.log('\nExit message output:');
        console.log(exitOutput);
        console.log('\n✅ All tests passed successfully!');
      } else {
        console.log('❌ Exit message does not show the expected path');
        console.log('Expected path:', expectedPath);
        console.log('Exit output:', exitOutput);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stdout) {
      console.error('Output:', error.stdout.toString());
    }
    if (error.stderr) {
      console.error('Error output:', error.stderr.toString());
    }
    process.exit(1);
  } finally {
    // Clean up
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log('\n🧹 Cleaned up test directory');
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Run the test
runTest().catch(console.error);
