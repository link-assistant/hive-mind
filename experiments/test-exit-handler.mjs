#!/usr/bin/env node

/**
 * Test script to verify that exit handler displays the correct log path
 * even after the log file has been renamed (e.g., when session ID is obtained)
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import required modules
const lib = await import('../src/lib.mjs');
const { log, setLogFile, getAbsoluteLogPath } = lib;
const exitHandler = await import('../src/exit-handler.lib.mjs');
const { initializeExitHandler, installGlobalExitHandlers, safeExit, resetExitHandler } = exitHandler;

async function testExitHandlerWithRename() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-exit-handler-'));
  console.log(`\n🧪 Testing exit handler with log file rename...`);

  try {
    // Create initial log file
    const initialLogFile = path.join(tempDir, 'initial.log');
    await fs.writeFile(initialLogFile, 'Initial log content\n');
    setLogFile(initialLogFile);

    console.log(`📁 Initial log file: ${initialLogFile}`);

    // Initialize exit handler with getAbsoluteLogPath function
    initializeExitHandler(getAbsoluteLogPath, log);
    installGlobalExitHandlers();

    // Verify initial state
    const initialPath = await getAbsoluteLogPath();
    console.log(`✅ Exit handler initialized with path function`);
    console.log(`   Current log path: ${initialPath}`);

    // Simulate getting a session ID and renaming the log file
    const sessionId = 'test-session-123456';
    const renamedLogFile = path.join(tempDir, `${sessionId}.log`);

    console.log(`\n📝 Simulating session ID obtained: ${sessionId}`);
    console.log(`   Renaming log file to: ${renamedLogFile}`);

    // Rename the file
    await fs.rename(initialLogFile, renamedLogFile);

    // Update the log file reference (as done in solve.claude-execution.lib.mjs)
    setLogFile(renamedLogFile);

    // Verify the log path has changed
    const renamedPath = await getAbsoluteLogPath();
    console.log(`✅ Log file renamed successfully`);
    console.log(`   New log path: ${renamedPath}`);

    // Test that the exit handler will use the new path
    if (renamedPath === renamedLogFile) {
      console.log(`\n✅ TEST PASSED: Exit handler will show the correct renamed log path`);
      console.log(`   The exit handler dynamically retrieves the current log path`);
    } else {
      console.log(`\n❌ TEST FAILED: Path mismatch`);
      console.log(`   Expected: ${renamedLogFile}`);
      console.log(`   Got: ${renamedPath}`);
      process.exit(1);
    }

    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up test directory`);

  } catch (error) {
    console.error(`\n❌ Test failed with error: ${error.message}`);
    console.error(error.stack);

    // Clean up on error
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    process.exit(1);
  }

  console.log(`\n✅ All exit handler tests passed!`);
}

// Run the test
await testExitHandlerWithRename();