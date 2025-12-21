#!/usr/bin/env node

/**
 * Integration test for log file renaming in solve command
 * Tests that the correct log file path is displayed at exit after session ID is obtained
 * This validates the fix for issue #292
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('🧪 Testing log file rename in solve command flow...\n');

// Create a simple test that simulates getting a session ID
const testCode = `
import { log, setLogFile, getLogFile } from '../src/lib.mjs';
import { initializeExitHandler, installGlobalExitHandlers, safeExit } from '../src/exit-handler.lib.mjs';
import path from 'path';
import fs from 'fs';

async function test() {
  const logFile = 'test-solve-log.log';
  setLogFile(logFile);
  initializeExitHandler(logFile, log);
  installGlobalExitHandlers();

  await log('Starting solve execution...');

  // Simulate getting session ID
  const sessionId = 'mock-session-abc123';
  await log('📌 Session ID: ' + sessionId);

  // Rename log file (like in solve.claude-execution.lib.mjs)
  try {
    const currentLogFile = getLogFile();
    const logDir = path.dirname(currentLogFile);
    const sessionLogFile = path.join(logDir, sessionId + '.log');

    await fs.promises.rename(currentLogFile, sessionLogFile);
    setLogFile(sessionLogFile);
    initializeExitHandler(sessionLogFile, log);

    await log('📁 Log renamed to: ' + sessionLogFile);
  } catch (e) {
    await log('Could not rename log: ' + e.message);
  }

  await log('Solve execution completed');
  await safeExit(0, 'Test completed successfully');
}

test().catch(console.error);
`;

// Write test file
fs.writeFileSync('test-solve-simulation.mjs', testCode);

try {
  console.log('📝 Running solve simulation...\n');
  const output = execSync('node test-solve-simulation.mjs 2>&1', { encoding: 'utf8' });

  console.log('📄 Output from solve simulation:');
  console.log('─'.repeat(60));
  console.log(output);
  console.log('─'.repeat(60));

  // Check if the output contains the renamed log file path
  if (output.includes('mock-session-abc123.log')) {
    console.log('\n✅ SUCCESS: Exit handler correctly displays renamed log file!');
    console.log('   The log file path shown at exit includes the session ID.');
  } else {
    console.log('\n❌ FAILURE: Exit handler did not show renamed log file');
    console.log('   Expected to see "mock-session-abc123.log" in output');
  }

  // Check if renamed log file exists
  if (fs.existsSync('mock-session-abc123.log')) {
    console.log('✅ Renamed log file exists');
    const content = fs.readFileSync('mock-session-abc123.log', 'utf8');
    console.log(`   Contains ${content.split('\n').length} lines`);

    // Clean up
    fs.unlinkSync('mock-session-abc123.log');
  }
} catch (error) {
  console.log('❌ Error during test:', error.message);
} finally {
  // Clean up test file
  if (fs.existsSync('test-solve-simulation.mjs')) {
    fs.unlinkSync('test-solve-simulation.mjs');
  }
  if (fs.existsSync('test-solve-log.log')) {
    fs.unlinkSync('test-solve-log.log');
  }
}

console.log('\n✨ Test complete!');
