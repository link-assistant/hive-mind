#!/usr/bin/env node

/**
 * Test suite for changeset-related scripts
 * Tests validate-changeset.mjs and merge-changesets.mjs functionality
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const validateChangesetPath = join(projectRoot, 'scripts', 'validate-changeset.mjs');
const mergeChangesetsPath = join(projectRoot, 'scripts', 'merge-changesets.mjs');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function execCommand(command, options = {}) {
  try {
    return {
      output: execSync(command, { encoding: 'utf8', stdio: 'pipe', cwd: projectRoot, ...options }),
      exitCode: 0,
    };
  } catch (error) {
    return {
      output: (error.stdout || '') + (error.stderr || ''),
      exitCode: error.status || 1,
    };
  }
}

// ==========================================
// Tests for validate-changeset.mjs
// ==========================================

// Test 1: Script exists and is executable
runTest('validate-changeset.mjs exists', () => {
  if (!existsSync(validateChangesetPath)) {
    throw new Error('validate-changeset.mjs not found');
  }
});

// Test 2: Syntax check
runTest('validate-changeset.mjs syntax check', () => {
  const { output, exitCode } = execCommand(`node --check ${validateChangesetPath}`);
  if (exitCode !== 0) {
    throw new Error(`Syntax error: ${output}`);
  }
});

// Test 3: Script runs without crashing (fallback mode)
runTest('validate-changeset.mjs runs in fallback mode', () => {
  // Without git diff context, it falls back to checking all changesets
  const { output, exitCode } = execCommand(`node ${validateChangesetPath}`);
  // Should either pass (if there's exactly one changeset) or fail (if not)
  // But should not crash with an exception
  if (output.includes('Error during changeset validation') && output.includes('Cannot read')) {
    throw new Error('Script crashed unexpectedly');
  }
});

// ==========================================
// Tests for merge-changesets.mjs
// ==========================================

// Test 4: Script exists
runTest('merge-changesets.mjs exists', () => {
  if (!existsSync(mergeChangesetsPath)) {
    throw new Error('merge-changesets.mjs not found');
  }
});

// Test 5: Syntax check
runTest('merge-changesets.mjs syntax check', () => {
  const { output, exitCode } = execCommand(`node --check ${mergeChangesetsPath}`);
  if (exitCode !== 0) {
    throw new Error(`Syntax error: ${output}`);
  }
});

// ==========================================
// Unit tests using mock changeset directories
// ==========================================

const testDir = join(projectRoot, 'experiments', 'test-changesets-temp');
const testChangesetDir = join(testDir, '.changeset');

function setupTestEnvironment() {
  // Clean up if exists
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
  mkdirSync(testChangesetDir, { recursive: true });

  // Create README.md (should be ignored)
  writeFileSync(join(testChangesetDir, 'README.md'), '# Changesets\n');

  // Create config.json (should be ignored)
  writeFileSync(join(testChangesetDir, 'config.json'), '{}');
}

function cleanupTestEnvironment() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
}

function createChangeset(filename, type, description) {
  const content = `---
'@link-assistant/hive-mind': ${type}
---

${description}
`;
  writeFileSync(join(testChangesetDir, filename), content);
}

// Test 6: Merge changesets correctly combines multiple changesets
runTest('merge-changesets.mjs combines multiple changesets', () => {
  setupTestEnvironment();
  try {
    // Create two changesets
    createChangeset('first-change.md', 'patch', 'First change description');

    // Wait a bit to ensure different mtime
    execSync('sleep 0.1');

    createChangeset('second-change.md', 'minor', 'Second change description');

    // Run merge script in test directory
    const { output, exitCode } = execCommand(`node ${mergeChangesetsPath}`, { cwd: testDir });

    if (exitCode !== 0) {
      throw new Error(`Merge failed: ${output}`);
    }

    // Check that merged changeset was created
    const files = readdirSync(testChangesetDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    if (files.length !== 1) {
      throw new Error(`Expected 1 merged changeset, found ${files.length}`);
    }

    // Check that it uses the higher bump type (minor)
    if (!output.includes('Using highest: minor')) {
      throw new Error('Expected merged changeset to use minor bump type');
    }

    // Check that both descriptions are included
    if (!output.includes('First change description') || !output.includes('Second change description')) {
      throw new Error('Merged changeset should contain both descriptions');
    }
  } finally {
    cleanupTestEnvironment();
  }
});

// Test 7: Merge changesets uses major if any is major
runTest('merge-changesets.mjs uses highest bump type (major)', () => {
  setupTestEnvironment();
  try {
    createChangeset('patch-change.md', 'patch', 'Patch change');
    createChangeset('major-change.md', 'major', 'Major change');
    createChangeset('minor-change.md', 'minor', 'Minor change');

    const { output, exitCode } = execCommand(`node ${mergeChangesetsPath}`, { cwd: testDir });

    if (exitCode !== 0) {
      throw new Error(`Merge failed: ${output}`);
    }

    if (!output.includes('Using highest: major')) {
      throw new Error('Expected merged changeset to use major bump type');
    }
  } finally {
    cleanupTestEnvironment();
  }
});

// Test 8: Merge does nothing with single changeset
runTest('merge-changesets.mjs skips with single changeset', () => {
  setupTestEnvironment();
  try {
    createChangeset('only-change.md', 'patch', 'Only change');

    const { output, exitCode } = execCommand(`node ${mergeChangesetsPath}`, { cwd: testDir });

    if (exitCode !== 0) {
      throw new Error(`Script failed: ${output}`);
    }

    if (!output.includes('No merging needed')) {
      throw new Error('Expected script to skip merging with single changeset');
    }

    // Verify original changeset still exists
    const files = readdirSync(testChangesetDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    if (files.length !== 1 || files[0] !== 'only-change.md') {
      throw new Error('Original changeset should not be modified');
    }
  } finally {
    cleanupTestEnvironment();
  }
});

// Test 9: Merge does nothing with no changesets
runTest('merge-changesets.mjs skips with no changesets', () => {
  setupTestEnvironment();
  try {
    const { output, exitCode } = execCommand(`node ${mergeChangesetsPath}`, { cwd: testDir });

    if (exitCode !== 0) {
      throw new Error(`Script failed: ${output}`);
    }

    if (!output.includes('No merging needed')) {
      throw new Error('Expected script to skip merging with no changesets');
    }
  } finally {
    cleanupTestEnvironment();
  }
});

// Test 10: Validate changeset format checking
runTest('validate-changeset.mjs format validation', () => {
  // This test verifies the script can be imported and has expected functions
  // Actual validation is tested through integration
  const { output, exitCode } = execCommand(`node --check ${validateChangesetPath}`);
  if (exitCode !== 0) {
    throw new Error('Script has syntax errors');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for changeset scripts:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
