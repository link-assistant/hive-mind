#!/usr/bin/env node

// Test script to simulate an error after log file is created

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import lib functions
const lib = await import('../src/lib.mjs');
const { log, setLogFile, displayFormattedError, getAbsoluteLogPath } = lib;

async function testErrorWithLogPath() {
  console.log('🧪 Testing error display with absolute log path...\n');

  // Create a test log file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(process.cwd(), `test-error-${timestamp}.log`);

  // Initialize log file
  setLogFile(logFile);
  await fs.writeFile(logFile, `# Test Log - ${new Date().toISOString()}\n\n`);

  // Display initial log path (absolute)
  const absolutePath = await getAbsoluteLogPath();
  console.log(`📁 Log file: ${absolutePath}\n`);

  // Simulate an error and use displayFormattedError
  await displayFormattedError({
    title: 'Test Error Occurred',
    what: 'This is a simulated error to test log path display',
    details: 'The error occurred during testing',
    causes: ['Test cause 1', 'Test cause 2'],
    fixes: ['Check the full log file for details', 'Review error messages']
  });

  // Test unhandled error handler
  console.log('\n📝 Testing unhandled error handler...');

  // Simulate uncaught exception
  process.on('uncaughtException', async error => {
    await log(`\n❌ Uncaught Exception: ${error.message}`, { level: 'error' });
    await log(`   📁 Full log file: ${absolutePath}`, { level: 'error' });

    // Clean up test log file
    try {
      await fs.unlink(logFile);
      console.log('\n✅ Test completed - log file cleaned up');
    } catch (e) {
      // Ignore cleanup errors
    }
    process.exit(0);
  });

  // Trigger an uncaught exception
  setTimeout(() => {
    throw new Error('Simulated uncaught exception');
  }, 100);
}

testErrorWithLogPath().catch(console.error);
