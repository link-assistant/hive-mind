#!/usr/bin/env node
// Test to verify that prompt files are created in OS temp directory, not in repository workspace

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

const testName = 'Prompt File Location Test';
log(`\n📋 Running: ${testName}`, 'blue');
log('─'.repeat(60), 'blue');

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (condition) {
    log(`✅ ${message}`, 'green');
    passed++;
  } else {
    log(`❌ ${message}`, 'red');
    failed++;
  }
};

try {
  // Test 1: Verify codex.lib.mjs uses os.tmpdir()
  log('\n1️⃣  Testing codex.lib.mjs...', 'yellow');
  const codexLibPath = join(__dirname, '../src/codex.lib.mjs');
  const codexLibContent = readFileSync(codexLibPath, 'utf-8');

  // Check that os module is imported
  assert(
    codexLibContent.includes('await use(\'os\')'),
    'codex.lib.mjs imports os module'
  );

  // Check that os.tmpdir() is used for prompt file
  assert(
    codexLibContent.includes('os.tmpdir()') &&
    codexLibContent.includes('codex_prompt_'),
    'codex.lib.mjs uses os.tmpdir() for prompt file'
  );

  // Check that old pattern (tempDir, 'codex_prompt.txt') is NOT present
  assert(
    !codexLibContent.includes('tempDir, \'codex_prompt.txt\''),
    'codex.lib.mjs does NOT use repository workspace for prompt file'
  );

  // Check that prompt file has unique name (timestamp + pid)
  assert(
    codexLibContent.includes('Date.now()') && codexLibContent.includes('process.pid'),
    'codex.lib.mjs creates unique prompt filename'
  );

  // Test 2: Verify opencode.lib.mjs uses os.tmpdir()
  log('\n2️⃣  Testing opencode.lib.mjs...', 'yellow');
  const opencodeLibPath = join(__dirname, '../src/opencode.lib.mjs');
  const opencodeLibContent = readFileSync(opencodeLibPath, 'utf-8');

  // Check that os module is imported
  assert(
    opencodeLibContent.includes('await use(\'os\')'),
    'opencode.lib.mjs imports os module'
  );

  // Check that os.tmpdir() is used for prompt file
  assert(
    opencodeLibContent.includes('os.tmpdir()') &&
    opencodeLibContent.includes('opencode_prompt_'),
    'opencode.lib.mjs uses os.tmpdir() for prompt file'
  );

  // Check that old pattern (tempDir, 'opencode_prompt.txt') is NOT present
  assert(
    !opencodeLibContent.includes('tempDir, \'opencode_prompt.txt\''),
    'opencode.lib.mjs does NOT use repository workspace for prompt file'
  );

  // Check that prompt file has unique name (timestamp + pid)
  assert(
    opencodeLibContent.includes('Date.now()') && opencodeLibContent.includes('process.pid'),
    'opencode.lib.mjs creates unique prompt filename'
  );

  // Test 3: Verify claude.lib.mjs does NOT create prompt files
  log('\n3️⃣  Testing claude.lib.mjs...', 'yellow');
  const claudeLibPath = join(__dirname, '../src/claude.lib.mjs');
  const claudeLibContent = readFileSync(claudeLibPath, 'utf-8');

  // Check that claude does not create prompt files
  assert(
    !claudeLibContent.includes('claude_prompt.txt') &&
    !claudeLibContent.includes('claude_prompt_'),
    'claude.lib.mjs does NOT create prompt files (as expected)'
  );

  // Test 4: Verify .gitignore patterns (informational)
  log('\n4️⃣  Checking .gitignore patterns...', 'yellow');
  const gitignorePath = join(__dirname, '../.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignoreContent = readFileSync(gitignorePath, 'utf-8');

    // This is informational - we don't fail if these patterns are missing
    // since the files should no longer be created in the repo workspace
    if (gitignoreContent.includes('*_prompt.txt') ||
        gitignoreContent.includes('codex_prompt.txt') ||
        gitignoreContent.includes('opencode_prompt.txt')) {
      log('ℹ️  Note: .gitignore contains prompt file patterns (safe but no longer necessary)', 'yellow');
    } else {
      log('ℹ️  Note: .gitignore does not contain prompt file patterns (correct - files now in OS temp)', 'yellow');
    }
  }

  // Test 5: Verify files can be created in OS temp directory
  log('\n5️⃣  Testing OS temp directory access...', 'yellow');
  const osTmpDir = tmpdir();
  assert(
    existsSync(osTmpDir),
    `OS temp directory exists: ${osTmpDir}`
  );

  // Try to create a test file in temp directory
  try {
    const testFilePath = join(osTmpDir, `test_prompt_${Date.now()}_${process.pid}.txt`);
    execSync(`echo "test" > "${testFilePath}"`);
    const testFileExists = existsSync(testFilePath);
    assert(
      testFileExists,
      'Can create files in OS temp directory'
    );

    // Clean up test file
    if (testFileExists) {
      execSync(`rm "${testFilePath}"`);
    }
  } catch (error) {
    assert(false, `Error testing OS temp directory access: ${error.message}`);
  }

} catch (error) {
  log(`\n❌ Test error: ${error.message}`, 'red');
  log(error.stack, 'red');
  failed++;
}

// Summary
log('\n' + '─'.repeat(60), 'blue');
log(`📊 Test Summary: ${testName}`, 'blue');
log(`   ✅ Passed: ${passed}`, passed > 0 ? 'green' : 'reset');
log(`   ❌ Failed: ${failed}`, failed > 0 ? 'red' : 'reset');
log('─'.repeat(60), 'blue');

if (failed > 0) {
  log(`\n❌ ${testName} FAILED\n`, 'red');
  process.exit(1);
} else {
  log(`\n✅ ${testName} PASSED\n`, 'green');
  process.exit(0);
}
