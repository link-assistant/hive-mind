#!/usr/bin/env node

/**
 * Experiment script to reproduce issue #504: hive command silent failure
 *
 * This script tests various invocations of the hive command to identify
 * when and why it fails silently.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = join(__dirname, '..', 'src');
const hivePath = join(srcDir, 'hive.mjs');

console.log('=== Testing hive command silent failure (Issue #504) ===\n');

/**
 * Run a command and capture its output
 */
function runCommand(command, args, timeout = 10000) {
  return new Promise(resolve => {
    console.log(`\n📋 Running: ${command} ${args.join(' ')}`);
    console.log('⏱️  Waiting for output...\n');

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeout,
    });

    let stdout = '';
    let stderr = '';
    let hasOutput = false;

    child.stdout.on('data', data => {
      hasOutput = true;
      const output = data.toString();
      stdout += output;
      process.stdout.write(`  [stdout] ${output}`);
    });

    child.stderr.on('data', data => {
      hasOutput = true;
      const output = data.toString();
      stderr += output;
      process.stderr.write(`  [stderr] ${output}`);
    });

    const timer = setTimeout(() => {
      console.log(`\n⏰ Timeout reached (${timeout}ms)`);
      child.kill('SIGTERM');
    }, timeout);

    child.on('close', code => {
      clearTimeout(timer);
      console.log(`\n✅ Process exited with code: ${code}`);
      console.log(`📊 Had output: ${hasOutput ? 'YES' : 'NO (SILENT FAILURE!)'}`);
      console.log(`📏 stdout length: ${stdout.length} bytes`);
      console.log(`📏 stderr length: ${stderr.length} bytes`);

      resolve({
        code,
        stdout,
        stderr,
        hasOutput,
        command: `${command} ${args.join(' ')}`,
      });
    });

    child.on('error', error => {
      clearTimeout(timer);
      console.log(`\n❌ Process error: ${error.message}`);
      resolve({
        code: -1,
        stdout,
        stderr,
        hasOutput,
        error: error.message,
        command: `${command} ${args.join(' ')}`,
      });
    });
  });
}

/**
 * Main test runner
 */
async function main() {
  const tests = [
    {
      name: 'Test 1: hive --help (should work)',
      command: hivePath,
      args: ['--help'],
    },
    {
      name: 'Test 2: hive --version (should work)',
      command: hivePath,
      args: ['--version'],
    },
    {
      name: 'Test 3: hive github.com/konard --dry-run (reported failing)',
      command: hivePath,
      args: ['github.com/konard', '--dry-run', '--skip-tool-check', '--once', '--max-issues', '1'],
    },
    {
      name: 'Test 4: hive https://github.com/konard --dry-run (reported failing)',
      command: hivePath,
      args: ['https://github.com/konard', '--dry-run', '--skip-tool-check', '--once', '--max-issues', '1'],
    },
    {
      name: 'Test 5: hive with no arguments (should show error)',
      command: hivePath,
      args: [],
    },
  ];

  const results = [];

  for (const test of tests) {
    console.log('\n' + '='.repeat(80));
    console.log(`🧪 ${test.name}`);
    console.log('='.repeat(80));

    const result = await runCommand(test.command, test.args);
    results.push({ ...test, ...result });

    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80) + '\n');

  const silentFailures = results.filter(r => !r.hasOutput && r.code === 0);

  for (const result of results) {
    const status = result.hasOutput ? '✅ Has output' : '❌ SILENT FAILURE';
    console.log(`${status} - ${result.name}`);
    console.log(`  Command: ${result.command}`);
    console.log(`  Exit code: ${result.code}`);
    console.log('');
  }

  if (silentFailures.length > 0) {
    console.log(`\n🚨 Found ${silentFailures.length} silent failure(s)!`);
    console.log('\nSilent failures detected:');
    silentFailures.forEach(f => {
      console.log(`  - ${f.name}`);
      console.log(`    ${f.command}`);
    });
  } else {
    console.log('\n✅ No silent failures detected');
  }
}

main().catch(error => {
  console.error('\n❌ Test script failed:', error);
  process.exit(1);
});
