#!/usr/bin/env node

// Test script to verify --attach-logs is passed from hive.mjs to solve.mjs
import { spawn } from 'child_process';

console.log('🧪 Testing --attach-logs flag passing...\n');

// Test dry run with --attach-logs flag
console.log('Testing: ./hive.mjs https://github.com/link-assistant/hive-mind --dry-run --once --attach-logs');

const child = spawn('./hive.mjs', [
  'https://github.com/link-assistant/hive-mind',
  '--dry-run',
  '--once',
  '--attach-logs',
  '--max-issues', '1'
], {
  stdio: 'pipe'
});

let output = '';
let errorOutput = '';

child.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  process.stdout.write(text);
});

child.stderr.on('data', (data) => {
  const text = data.toString();
  errorOutput += text;
  process.stderr.write(text);
});

child.on('close', (code) => {
  console.log(`\n🏁 Process exited with code: ${code}`);

  // Check if --attach-logs appears in the command output
  if (output.includes('--attach-logs')) {
    console.log('✅ SUCCESS: --attach-logs flag found in solve.mjs command');
  } else {
    console.log('❌ FAILURE: --attach-logs flag not found in solve.mjs command');
    console.log('\nFull output:');
    console.log(output);
  }
});

child.on('error', (error) => {
  console.error(`❌ Process error: ${error.message}`);
});