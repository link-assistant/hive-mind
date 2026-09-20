#!/usr/bin/env node
// Experiment: Test the stdio log interceptor (issue #1549)
// Verifies that process.stdout.write output is captured in the log file

import { log, setLogFile, setupStdioLogInterceptor, getLogFile } from '../src/lib.mjs';
import { promises as fs } from 'fs';

const testLogFile = '/tmp/test-stdio-interceptor.log';

// Clean up previous test
try {
  await fs.unlink(testLogFile);
} catch {}

// Setup
setLogFile(testLogFile);
setupStdioLogInterceptor();

// Test 1: Output via log() - should appear once in log file
await log('Message via log()');

// Test 2: Output via process.stdout.write - should be captured by interceptor
process.stdout.write('Message via process.stdout.write\n');

// Test 3: Output via console.log (not through our log()) - should be captured by interceptor
// Note: console.log calls process.stdout.write internally
const _writingFromLog = false; // The guard is internal to lib.mjs
console.log('Message via console.log directly');

// Test 4: Output via process.stderr.write - should be captured
process.stderr.write('Message via process.stderr.write\n');

// Wait for async file writes to complete
await new Promise(resolve => setTimeout(resolve, 200));

// Read and verify log file
const logContent = await fs.readFile(testLogFile, 'utf8');
console.log('\n=== Log file contents ===');
console.log(logContent);

// Verify
const lines = logContent.split('\n').filter(l => l.trim());
console.log('=== Verification ===');
console.log(`Total log lines: ${lines.length}`);

const hasLogMessage = lines.some(l => l.includes('[INFO] Message via log()'));
const hasStdoutWrite = lines.some(l => l.includes('[STDOUT] Message via process.stdout.write'));
const hasStderrWrite = lines.some(l => l.includes('[STDERR] Message via process.stderr.write'));

console.log(`Has log() message: ${hasLogMessage}`);
console.log(`Has stdout.write message: ${hasStdoutWrite}`);
console.log(`Has stderr.write message: ${hasStderrWrite}`);

// Check that log() message appears exactly once (not double-logged)
const logMessageCount = lines.filter(l => l.includes('Message via log()')).length;
console.log(`log() message count (should be 1): ${logMessageCount}`);

if (hasLogMessage && hasStdoutWrite && hasStderrWrite && logMessageCount === 1) {
  console.log('\n✅ All tests passed');
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}

// Cleanup
await fs.unlink(testLogFile);
