#!/usr/bin/env node

/**
 * Issue: JSON strings with quotes cause escaping issues
 *
 * Minimal reproduction showing that echo with JSON content fails
 * due to quote escaping problems in shell interpolation.
 *
 * Pattern: try { reproduction } catch { workaround }
 */

console.log('🐛 Issue #03: JSON escaping issues\n');

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Direct imports with top-level await
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Setup test content (no try-catch, should fail on error)
 */
async function setup() {
  console.log('📦 Setting up test JSON content...');

  const jsonData = {
    name: 'Test Project',
    description: 'A project with "quotes" and \'apostrophes\'',
    scripts: {
      test: 'echo "Running tests"',
      build: "node build.js --env='production'"
    },
    config: {
      special: 'Value with `backticks` and $variables'
    }
  };

  const jsonString = JSON.stringify(jsonData, null, 2);
  const testFile = path.join(os.tmpdir(), `test-json-${Date.now()}.json`);

  console.log(`   JSON length: ${jsonString.length} characters`);
  console.log(`   Contains: nested quotes, apostrophes, backticks`);
  console.log(`   Test file: ${testFile}`);
  console.log('✅ Setup complete\n');

  return { jsonData, jsonString, testFile };
}

/**
 * Cleanup function (no try-catch, best effort)
 */
async function cleanup(testFile) {
  await fs.unlink(testFile).catch(() => {});
}

/**
 * Main test - ONE try-catch block for reproduction and workaround
 */
async function runTest() {
  // SETUP (no try-catch)
  const { jsonData, jsonString, testFile } = await setup();

  console.log('='.repeat(60));

  try {
    // TRY: Reproduce the issue - echo JSON with quotes
    console.log('REPRODUCING ISSUE\n');
    console.log('1️⃣  Using command-stream $ with echo for JSON:');

    // This should fail or corrupt the JSON
    await $`echo '${jsonString}' > ${testFile}`;

    // Verify if JSON was preserved correctly
    const readBack = await fs.readFile(testFile, 'utf8');
    const parsed = JSON.parse(readBack);

    if (JSON.stringify(parsed) !== JSON.stringify(jsonData)) {
      // JSON was corrupted
      const error = new Error('JSON corrupted by shell escaping');
      error.original = jsonData;
      error.corrupted = parsed;
      throw error;
    }

    // If we get here, the issue may be fixed
    console.log('✅ Command worked (issue may be fixed)');
    console.log('   JSON preserved correctly');
  } catch (error) {
    // CATCH: Apply workaround
    console.log('❌ ISSUE CONFIRMED: JSON escaping failed');

    if (error.message.includes('JSON')) {
      console.log(`   Error: ${error.message}`);
    } else {
      console.log(`   JSON parsing failed: ${error.message}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('APPLYING WORKAROUND\n');

    // WORKAROUND: Use fs.writeFile
    console.log('2️⃣  Using fs.writeFile workaround:');

    await fs.writeFile(testFile, jsonString);
    const verifyContent = await fs.readFile(testFile, 'utf8');
    const verifyParsed = JSON.parse(verifyContent);

    if (JSON.stringify(verifyParsed) === JSON.stringify(jsonData)) {
      console.log('✅ WORKAROUND SUCCESSFUL!');
      console.log('   fs.writeFile preserved JSON perfectly');
    }
  }

  // CLEANUP
  await cleanup(testFile);

  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY\n');
  console.log('❌ ISSUE: Shell interpolation corrupts JSON strings');
  console.log('   • Nested quotes get escaped incorrectly');
  console.log('   • Special characters cause parsing errors');
  console.log('   • JSON becomes invalid after shell processing');

  console.log('\n✅ WORKAROUND:');
  console.log('   Use fs.writeFile() for JSON data');

  console.log('\nExample workaround code:');
  console.log("  // Don't use echo for JSON");
  console.log('  await fs.writeFile(file, JSON.stringify(data, null, 2));');
}

// Run the test
await runTest();
