#!/usr/bin/env node

/**
 * Test script to verify that log file renaming works correctly when session ID is obtained
 * This tests the fix for issue #292
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the lib functions
import { log, setLogFile, getLogFile } from '../src/lib.mjs';
import { initializeExitHandler, installGlobalExitHandlers } from '../src/exit-handler.lib.mjs';

async function simulateSessionIdCapture() {
  console.log('🧪 Testing log file rename when session ID is captured...\n');

  // Set up initial log file
  const testDir = path.join(__dirname, 'test-logs');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const initialLogFile = path.join(testDir, 'test-solve-2024-09-24.log');
  setLogFile(initialLogFile);

  // Initialize exit handler with initial log file
  initializeExitHandler(initialLogFile, log);
  installGlobalExitHandlers();

  console.log(`📝 Initial log file: ${initialLogFile}`);
  console.log(`📝 getLogFile() returns: ${getLogFile()}\n`);

  // Create the initial log file
  await log('Starting test execution...');
  await log('Simulating Claude command execution...');

  // Simulate receiving a session ID
  const sessionId = 'test-session-12345';
  console.log(`\n📌 Simulating session ID capture: ${sessionId}`);

  // Simulate the log rename logic (as implemented in solve.claude-execution.lib.mjs)
  try {
    const currentLogFile = getLogFile();
    const logDir = path.dirname(currentLogFile);
    const sessionLogFile = path.join(logDir, `${sessionId}.log`);

    console.log(`🔄 Attempting to rename log file...`);
    console.log(`   From: ${currentLogFile}`);
    console.log(`   To: ${sessionLogFile}`);

    // Rename the file
    await fs.promises.rename(currentLogFile, sessionLogFile);

    // Update the global log file reference
    setLogFile(sessionLogFile);

    // Re-initialize exit handler with new log path
    initializeExitHandler(sessionLogFile, log);

    console.log(`✅ Log file renamed successfully!`);
    console.log(`📝 getLogFile() now returns: ${getLogFile()}\n`);

    // Write to the renamed log file
    await log('Log file has been renamed with session ID');
    await log('This should be written to the renamed file');

    // Verify the renamed file exists and has content
    if (fs.existsSync(sessionLogFile)) {
      console.log('✅ Renamed log file exists');
      const content = fs.readFileSync(sessionLogFile, 'utf8');
      console.log(`📄 Renamed log file contains ${content.split('\n').length} lines\n`);
    } else {
      console.log('❌ ERROR: Renamed log file does not exist!\n');
    }

    // Simulate exit to verify correct log path is displayed
    console.log('🔍 Simulating process exit to check displayed log path...');
    console.log('   The exit handler should show the renamed log path:\n');

    // Trigger exit handler manually for testing
    process.emit('exit', 0);

    // Clean up test files
    setTimeout(async () => {
      console.log('\n🧹 Cleaning up test files...');
      try {
        if (fs.existsSync(sessionLogFile)) {
          fs.unlinkSync(sessionLogFile);
        }
        if (fs.existsSync(initialLogFile)) {
          fs.unlinkSync(initialLogFile);
        }
        if (fs.existsSync(testDir)) {
          fs.rmdirSync(testDir, { recursive: true });
        }
        console.log('✅ Test files cleaned up');
      } catch (e) {
        console.log(`⚠️ Could not clean up test files: ${e.message}`);
      }
    }, 1000);
  } catch (error) {
    console.log(`❌ ERROR during test: ${error.message}`);
  }
}

// Run the test
simulateSessionIdCapture().catch(console.error);
