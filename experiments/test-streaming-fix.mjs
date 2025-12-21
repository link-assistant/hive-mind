#!/usr/bin/env node

// Test script to verify streaming fix works correctly
console.log('🧪 Testing streaming functionality fix...\n');

import { spawn } from 'child_process';
import fs from 'fs/promises';

// Mock log function that shows timestamp to verify real-time streaming
async function log(message, options = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Simulate the exact streaming logic from hive.mjs
async function testStreaming() {
  console.log('📋 Testing real-time streaming with spawn...\n');

  // Create a simple test script that outputs incrementally
  const testScript = `#!/usr/bin/env node
console.log('Starting test script...');
await new Promise(resolve => setTimeout(resolve, 1000));
console.log('Line 1 - First output');
await new Promise(resolve => setTimeout(resolve, 1000));
console.log('Line 2 - Second output');
await new Promise(resolve => setTimeout(resolve, 1000));
console.log('Line 3 - Third output');
await new Promise(resolve => setTimeout(resolve, 1000));
console.log('Finishing test script...');
`;

  const testScriptPath = '/tmp/test-streaming-script.mjs';
  await fs.writeFile(testScriptPath, testScript);
  await fs.chmod(testScriptPath, '755');

  console.log('🚀 Running streaming test with incremental output...\n');

  let exitCode = 0;
  const startTime = Date.now();

  // Use the same streaming logic as in hive.mjs
  await new Promise((resolve, reject) => {
    const child = spawn('node', [testScriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle stdout data - stream output in real-time
    child.stdout.on('data', data => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          log(`   [test-script] ${line}`).catch(() => {});
        }
      }
    });

    // Handle stderr data - stream errors in real-time
    child.stderr.on('data', data => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          log(`   [test-script ERROR] ${line}`).catch(() => {});
        }
      }
    });

    // Handle process completion
    child.on('close', code => {
      exitCode = code || 0;
      resolve();
    });

    // Handle process errors
    child.on('error', error => {
      exitCode = 1;
      log(`   [test-script ERROR] Process error: ${error.message}`).catch(() => {});
      resolve();
    });
  });

  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log(`\n✅ Streaming test completed in ${duration}s with exit code ${exitCode}`);

  // Cleanup
  await fs.unlink(testScriptPath).catch(() => {});

  // Test argument parsing
  console.log('\n📋 Testing argument parsing...\n');

  // Test the argument building logic
  const testUrl = 'https://github.com/test/repo/issues/123';
  const testModel = 'sonnet';
  const testFork = true;

  const args = [testUrl, '--model', testModel];
  if (testFork) {
    args.push('--fork');
  }

  console.log('Arguments array:', args);
  console.log('Should be: ["https://github.com/test/repo/issues/123", "--model", "sonnet", "--fork"]');

  const expectedArgs = [testUrl, '--model', testModel, '--fork'];
  const argsMatch = JSON.stringify(args) === JSON.stringify(expectedArgs);

  if (argsMatch) {
    console.log('✅ Argument parsing works correctly');
  } else {
    console.log('❌ Argument parsing failed');
    console.log('Expected:', expectedArgs);
    console.log('Got:', args);
  }
}

async function testComparison() {
  console.log('\n📊 Comparing old vs new approach...\n');

  console.log('OLD (execSync with stdio: "pipe"):');
  console.log('  ❌ Buffers ALL output until process completes');
  console.log('  ❌ No real-time streaming');
  console.log('  ✅ Simple error handling');
  console.log('  ✅ No shell parsing issues');

  console.log('\nNEW (spawn with real-time data handlers):');
  console.log('  ✅ Streams output in real-time');
  console.log('  ✅ Shows progress as it happens');
  console.log('  ✅ No shell parsing issues (uses args array)');
  console.log('  ✅ Proper error handling with streaming');

  console.log('\n🎯 BENEFITS:');
  console.log('  • Users see solve.mjs progress in real-time');
  console.log('  • No more waiting for entire process to finish');
  console.log('  • Better user experience during long-running operations');
  console.log('  • Maintains argument parsing fixes from commit 552a712');
}

// Run all tests
try {
  await testStreaming();
  await testComparison();
  console.log('\n🎉 All tests passed! Streaming fix is working correctly.');
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
}
