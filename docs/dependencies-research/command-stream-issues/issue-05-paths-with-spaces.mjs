#!/usr/bin/env node

/**
 * Issue: File paths with spaces need proper quoting
 *
 * Minimal reproduction showing that paths with spaces fail
 * when not properly quoted in shell commands.
 *
 * Pattern: try { reproduction } catch { workaround }
 */

console.log('🐛 Issue #05: Paths with spaces\n');

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Direct imports with top-level await
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Setup test environment (no try-catch, should fail on error)
 */
async function setup() {
  console.log('📦 Setting up test directories with spaces...');

  const baseDir = path.join(os.tmpdir(), `test spaces ${Date.now()}`);
  const testFile = path.join(baseDir, 'my file.txt');

  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(testFile, 'test content');

  console.log(`   Directory: ${baseDir}`);
  console.log(`   File: ${testFile}`);
  console.log('✅ Setup complete\n');

  return { baseDir, testFile };
}

/**
 * Cleanup function (no try-catch, best effort)
 */
async function cleanup(baseDir) {
  await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Main test - ONE try-catch block for reproduction and workaround
 */
async function runTest() {
  // SETUP (no try-catch)
  const { baseDir, testFile } = await setup();

  console.log('='.repeat(60));

  try {
    // TRY: Reproduce the issue - unquoted path with spaces
    console.log('REPRODUCING ISSUE\n');
    console.log('1️⃣  Using command-stream $ with unquoted path:');

    // This should fail due to spaces in path
    const result = await $`cat ${testFile}`;

    // If we get here without error, check if it actually worked
    if (!result.stdout.toString().includes('test content')) {
      throw new Error('Command succeeded but content not found');
    }

    console.log('✅ Command worked (issue may be fixed or auto-quoted)');
  } catch (error) {
    // CATCH: Apply workaround
    console.log('❌ ISSUE CONFIRMED: Unquoted paths with spaces failed');
    console.log(`   Error: ${error.message.split('\n')[0]}`);

    console.log('\n' + '='.repeat(60));
    console.log('APPLYING WORKAROUND\n');

    // WORKAROUND: Quote the path
    console.log('2️⃣  Using quoted path workaround:');

    const result = await $`cat "${testFile}"`;
    const content = result.stdout.toString().trim();

    if (content === 'test content') {
      console.log('✅ WORKAROUND SUCCESSFUL!');
      console.log('   Quoted path worked correctly');
    }

    // Alternative: Use fs operations
    console.log('\n3️⃣  Alternative: Using fs.readFile:');
    const fsContent = await fs.readFile(testFile, 'utf8');
    console.log(`   ✅ fs.readFile always works: "${fsContent}"`);
  }

  // CLEANUP
  await cleanup(baseDir);

  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY\n');
  console.log('❌ ISSUE: Paths with spaces need explicit quoting');
  console.log('   • Unquoted paths break at spaces');
  console.log('   • Auto-quoting is inconsistent');

  console.log('\n✅ WORKAROUNDS:');
  console.log('   1. Always quote paths: "${path}"');
  console.log('   2. Use fs operations when possible');

  console.log('\nExample workaround code:');
  console.log('  // Always quote paths with potential spaces');
  console.log('  await $`cat "${filePath}"`;');
}

// Run the test
await runTest();
