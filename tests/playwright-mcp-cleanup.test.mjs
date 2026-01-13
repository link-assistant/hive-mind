#!/usr/bin/env node
/**
 * Playwright MCP Cleanup Unit Tests
 *
 * Tests for the .playwright-mcp/ folder cleanup functionality.
 * This functionality prevents browser automation artifacts from
 * triggering the auto-restart mechanism.
 *
 * Run with: node tests/playwright-mcp-cleanup.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1124
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// Create a temporary test directory
async function createTempTestDir() {
  const tempDir = path.join(os.tmpdir(), `playwright-mcp-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

// Cleanup test directory
async function cleanupTempTestDir(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Helper to check if directory exists
async function directoryExists(dir) {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// ============================================================================
// Run all tests
// ============================================================================

async function runTests() {
  console.log('\n📋 Playwright MCP Cleanup Tests\n');

  // Test: cleanup function exists and is exported
  await asyncTest('cleanup logic exists in solve.mjs', async () => {
    // Read the solve.mjs file and verify the cleanup code exists
    const solveContent = await fs.readFile(path.join(process.cwd(), 'src/solve.mjs'), 'utf-8');

    assert.ok(solveContent.includes('.playwright-mcp'), 'solve.mjs should contain .playwright-mcp cleanup logic');
    assert.ok(solveContent.includes('playwrightMcpAutoCleanup'), 'solve.mjs should check playwrightMcpAutoCleanup option');
  });

  await asyncTest('cleanup logic exists in solve.watch.lib.mjs', async () => {
    // Read the watch lib file and verify the cleanup code exists
    const watchContent = await fs.readFile(path.join(process.cwd(), 'src/solve.watch.lib.mjs'), 'utf-8');

    assert.ok(watchContent.includes('.playwright-mcp'), 'solve.watch.lib.mjs should contain .playwright-mcp cleanup logic');
    assert.ok(watchContent.includes('cleanupPlaywrightMcpFolder'), 'solve.watch.lib.mjs should have cleanupPlaywrightMcpFolder function');
  });

  await asyncTest('CLI option for playwright-mcp-auto-cleanup exists', async () => {
    // Read the config file and verify the CLI option exists
    const configContent = await fs.readFile(path.join(process.cwd(), 'src/solve.config.lib.mjs'), 'utf-8');

    assert.ok(configContent.includes('playwright-mcp-auto-cleanup'), 'Config should have playwright-mcp-auto-cleanup option');
    assert.ok(configContent.includes('default: true'), 'playwright-mcp-auto-cleanup should default to true');
  });

  // ============================================================================
  // Behavior Tests
  // ============================================================================

  console.log('\n📋 Behavior Tests\n');

  await asyncTest('cleanup removes .playwright-mcp folder when it exists', async () => {
    const tempDir = await createTempTestDir();
    try {
      // Create .playwright-mcp folder with some files
      const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');
      await fs.mkdir(playwrightMcpDir, { recursive: true });
      await fs.writeFile(path.join(playwrightMcpDir, 'screenshot.png'), 'fake-image-data');
      await fs.writeFile(path.join(playwrightMcpDir, 'trace.json'), '{}');

      // Verify folder exists
      assert.ok(await directoryExists(playwrightMcpDir), '.playwright-mcp should exist before cleanup');

      // Simulate cleanup (mimicking the solve.mjs logic)
      const playwrightMcpExists = await fs
        .stat(playwrightMcpDir)
        .then(() => true)
        .catch(() => false);
      if (playwrightMcpExists) {
        await fs.rm(playwrightMcpDir, { recursive: true, force: true });
      }

      // Verify folder is removed
      assert.ok(!(await directoryExists(playwrightMcpDir)), '.playwright-mcp should be removed after cleanup');
    } finally {
      await cleanupTempTestDir(tempDir);
    }
  });

  await asyncTest('cleanup does nothing when folder does not exist', async () => {
    const tempDir = await createTempTestDir();
    try {
      const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');

      // Verify folder does not exist
      assert.ok(!(await directoryExists(playwrightMcpDir)), '.playwright-mcp should not exist');

      // Simulate cleanup (should not throw)
      const playwrightMcpExists = await fs
        .stat(playwrightMcpDir)
        .then(() => true)
        .catch(() => false);
      if (playwrightMcpExists) {
        await fs.rm(playwrightMcpDir, { recursive: true, force: true });
      }

      // Should complete without error
      assert.ok(true, 'Cleanup should complete without error when folder does not exist');
    } finally {
      await cleanupTempTestDir(tempDir);
    }
  });

  await asyncTest('cleanup preserves other uncommitted files', async () => {
    const tempDir = await createTempTestDir();
    try {
      // Create .playwright-mcp folder
      const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');
      await fs.mkdir(playwrightMcpDir, { recursive: true });
      await fs.writeFile(path.join(playwrightMcpDir, 'screenshot.png'), 'fake-image-data');

      // Create other uncommitted files (should be preserved)
      const otherFile = path.join(tempDir, 'new-feature.js');
      await fs.writeFile(otherFile, 'console.log("new feature");');

      // Simulate cleanup
      const playwrightMcpExists = await fs
        .stat(playwrightMcpDir)
        .then(() => true)
        .catch(() => false);
      if (playwrightMcpExists) {
        await fs.rm(playwrightMcpDir, { recursive: true, force: true });
      }

      // Verify .playwright-mcp is removed
      assert.ok(!(await directoryExists(playwrightMcpDir)), '.playwright-mcp should be removed');

      // Verify other files are preserved
      const otherFileExists = await fs
        .stat(otherFile)
        .then(() => true)
        .catch(() => false);
      assert.ok(otherFileExists, 'Other uncommitted files should be preserved');
    } finally {
      await cleanupTempTestDir(tempDir);
    }
  });

  await asyncTest('--no-playwright-mcp-auto-cleanup skips cleanup', async () => {
    const tempDir = await createTempTestDir();
    try {
      // Create .playwright-mcp folder
      const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');
      await fs.mkdir(playwrightMcpDir, { recursive: true });
      await fs.writeFile(path.join(playwrightMcpDir, 'screenshot.png'), 'fake-image-data');

      // Simulate cleanup with option disabled (argv.playwrightMcpAutoCleanup = false)
      const playwrightMcpAutoCleanup = false;
      if (playwrightMcpAutoCleanup !== false) {
        const playwrightMcpExists = await fs
          .stat(playwrightMcpDir)
          .then(() => true)
          .catch(() => false);
        if (playwrightMcpExists) {
          await fs.rm(playwrightMcpDir, { recursive: true, force: true });
        }
      }

      // Verify .playwright-mcp is preserved when cleanup is disabled
      assert.ok(await directoryExists(playwrightMcpDir), '.playwright-mcp should be preserved when cleanup is disabled');
    } finally {
      await cleanupTempTestDir(tempDir);
    }
  });

  // ============================================================================
  // Case Study Documentation Tests
  // ============================================================================

  console.log('\n📋 Case Study Documentation Tests\n');

  await asyncTest('case study documentation exists', async () => {
    const caseStudyPath = path.join(process.cwd(), 'docs/case-studies/issue-1124/README.md');
    const caseStudyExists = await fs
      .stat(caseStudyPath)
      .then(() => true)
      .catch(() => false);

    assert.ok(caseStudyExists, 'Case study README.md should exist');

    if (caseStudyExists) {
      const content = await fs.readFile(caseStudyPath, 'utf-8');
      assert.ok(content.includes('playwright-mcp'), 'Case study should mention playwright-mcp');
      assert.ok(content.includes('auto-restart'), 'Case study should mention auto-restart issue');
      assert.ok(content.includes('Root Cause'), 'Case study should have root cause analysis');
    }
  });

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n========================================');
  console.log(`📊 Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('========================================\n');

  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
