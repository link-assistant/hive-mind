#!/usr/bin/env node

/**
 * Issue: Multi-line strings with special characters cause shell escaping problems
 *
 * Minimal reproduction showing that echo command fails with multi-line content
 * containing backticks, quotes, and shell special characters.
 *
 * Pattern: try { reproduction } catch { workaround }
 */

console.log('🐛 Issue #01: Multi-line strings with special characters\n');

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
  console.log('📦 Setting up test content...');

  const complexContent = `# Test Repository

This is a test repository with \`backticks\` and "quotes".

## Code Example
\`\`\`javascript
const message = "Hello, World!";
console.log(\`Message: \${message}\`);
\`\`\`

## Special Characters
- Single quotes: 'test'
- Double quotes: "test"
- Backticks: \`test\`
- Dollar signs: $100
- Backslashes: C:\\Windows\\System32`;

  const testFile = path.join(os.tmpdir(), `test-multiline-${Date.now()}.txt`);

  console.log(`   Content length: ${complexContent.length} characters`);
  console.log(`   Contains: backticks, quotes, newlines, $, backslashes`);
  console.log(`   Test file: ${testFile}`);
  console.log('✅ Setup complete\n');

  return { complexContent, testFile };
}

/**
 * Cleanup function (no try-catch, best effort)
 */
async function cleanup(testFile) {
  await fs.unlink(testFile).catch(() => {});
  await fs.unlink(testFile + '.backup').catch(() => {});
}

/**
 * Main test - ONE try-catch block for reproduction and workaround
 */
async function runTest() {
  // SETUP (no try-catch)
  const { complexContent, testFile } = await setup();

  console.log('='.repeat(60));

  try {
    // TRY: Reproduce the issue - echo with complex multi-line string
    console.log('REPRODUCING ISSUE\n');
    console.log('1️⃣  Using command-stream $ with echo for multi-line content:');

    // This should fail or corrupt the content
    await $`echo "${complexContent}" > ${testFile}`;

    // Verify if content was preserved correctly
    const readBack = await fs.readFile(testFile, 'utf8');

    if (readBack !== complexContent) {
      // Content was corrupted, throw error to trigger workaround
      const error = new Error('Content corrupted by shell escaping');
      error.expected = complexContent.length;
      error.actual = readBack.length;
      error.sampleExpected = complexContent.substring(0, 100);
      error.sampleActual = readBack.substring(0, 100);
      throw error;
    }

    // If we get here, the issue may be fixed
    console.log('✅ Command worked (issue may be fixed)');
    console.log(`   Content preserved: ${readBack.length} characters`);
  } catch (error) {
    // CATCH: Apply workaround
    console.log('❌ ISSUE CONFIRMED: Multi-line string escaping failed');

    if (error.expected) {
      console.log(`   Expected length: ${error.expected} chars`);
      console.log(`   Actual length: ${error.actual} chars`);
      console.log(`   Content corrupted or truncated`);
    } else {
      console.log(`   Error: ${error.message}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('APPLYING WORKAROUND\n');

    // WORKAROUND 1: Use fs.writeFile (most reliable)
    console.log('2️⃣  Using fs.writeFile workaround:');

    await fs.writeFile(testFile, complexContent);
    const verifyFs = await fs.readFile(testFile, 'utf8');

    if (verifyFs === complexContent) {
      console.log('✅ WORKAROUND SUCCESSFUL!');
      console.log('   fs.writeFile preserved content perfectly');
    }

    // WORKAROUND 2: Use heredoc
    console.log('\n3️⃣  Alternative: Using heredoc workaround:');

    const heredocResult = await $`cat << 'EOF' > ${testFile}.backup
${complexContent}
EOF`;

    const verifyHeredoc = await fs.readFile(testFile + '.backup', 'utf8');

    if (verifyHeredoc === complexContent) {
      console.log('✅ Heredoc also works!');
      console.log('   Content preserved with quoted EOF delimiter');
    } else {
      console.log('⚠️  Heredoc had issues too');
    }
  }

  // CLEANUP
  await cleanup(testFile);

  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY\n');
  console.log('❌ ISSUE: Shell interpolation of multi-line strings fails');
  console.log('   • Backticks get interpreted as command substitution');
  console.log('   • Dollar signs trigger variable expansion');
  console.log('   • Quotes and escapes get mangled');
  console.log('   • Newlines may be lost or corrupted');

  console.log('\n✅ WORKAROUNDS:');
  console.log('   1. Use fs.writeFile() - Most reliable for any content');
  console.log("   2. Use heredoc with quoted delimiter (cat << 'EOF')");
  console.log('   3. Avoid echo with complex interpolated strings');

  console.log('\nExample workaround code:');
  console.log('  // Best practice');
  console.log('  await fs.writeFile(file, content);');
  console.log('  // Alternative');
  console.log("  await $`cat << 'EOF' > ${file}\\n${content}\\nEOF`;");
}

// Run the test
await runTest();
