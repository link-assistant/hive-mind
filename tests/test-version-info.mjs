#!/usr/bin/env node
/**
 * Version Info Unit Tests
 *
 * Tests for the version-info.lib.mjs functionality:
 * - Parallel execution performance (issue #1320)
 * - Version message formatting by language groups
 * - Restart warning for version mismatch
 * - AI agent version checks (--tool options)
 *
 * Run with: node tests/test-version-info.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1320
 */

import assert from 'node:assert/strict';
import { getVersionInfo, formatVersionMessage } from '../src/version-info.lib.mjs';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

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

// ============================================================================
// getVersionInfo Tests
// ============================================================================

console.log('\n📋 getVersionInfo Tests\n');

await asyncTest('getVersionInfo returns success object', async () => {
  const result = await getVersionInfo(false);
  assert.ok(result.success === true, 'Result should have success: true');
  assert.ok(result.versions, 'Result should have versions object');
});

await asyncTest('getVersionInfo includes gatherTimeMs metric', async () => {
  const result = await getVersionInfo(false);
  assert.ok(typeof result.gatherTimeMs === 'number', 'gatherTimeMs should be a number');
  assert.ok(result.gatherTimeMs >= 0, 'gatherTimeMs should be non-negative');
});

await asyncTest('getVersionInfo completes in under 10 seconds (parallel execution)', async () => {
  const startTime = Date.now();
  await getVersionInfo(false);
  const duration = Date.now() - startTime;
  // Parallel execution should complete within 10 seconds
  // (sequential could take 30+ seconds with 30+ commands at 5s timeout each)
  assert.ok(duration < 10000, `Version gathering took ${duration}ms, expected < 10000ms`);
  console.log(`   (actual time: ${duration}ms)`);
});

await asyncTest('getVersionInfo includes hiveMind version', async () => {
  const result = await getVersionInfo(false);
  assert.ok(result.versions.hiveMind, 'Should have hiveMind version');
  // Should be a version string like "1.23.12"
  assert.ok(/^\d+\.\d+\.\d+/.test(result.versions.hiveMind), 'hiveMind should be a semver version');
});

await asyncTest('getVersionInfo includes Node.js version from process', async () => {
  const result = await getVersionInfo(false);
  assert.ok(result.versions.node, 'Should have node version');
  assert.equal(result.versions.node, process.version, 'Node version should match process.version');
});

await asyncTest('getVersionInfo includes platform info', async () => {
  const result = await getVersionInfo(false);
  assert.ok(result.versions.platform, 'Should have platform info');
  assert.ok(result.versions.platform.includes(process.platform), 'Platform should include OS');
  assert.ok(result.versions.platform.includes(process.arch), 'Platform should include architecture');
});

await asyncTest('getVersionInfo includes AI agent version fields', async () => {
  const result = await getVersionInfo(false);
  // These fields should exist (may be null if tools not installed)
  assert.ok('claudeCode' in result.versions, 'Should have claudeCode field');
  assert.ok('agent' in result.versions, 'Should have agent field');
  assert.ok('codex' in result.versions, 'Should have codex field');
  assert.ok('opencode' in result.versions, 'Should have opencode field');
  assert.ok('qwenCode' in result.versions, 'Should have qwenCode field');
  assert.ok('gemini' in result.versions, 'Should have gemini field');
  assert.ok('copilot' in result.versions, 'Should have copilot field');
});

await asyncTest('getVersionInfo with processVersion tracks restart warning', async () => {
  // Test with matching versions
  const resultMatch = await getVersionInfo(false, '1.23.12');
  // needsRestart depends on actual package version, so just check the field exists
  assert.ok('needsRestart' in resultMatch.versions, 'Should have needsRestart field');

  // Test with different process version
  const resultDiff = await getVersionInfo(false, '0.0.1');
  assert.ok(resultDiff.versions.needsRestart === true, 'needsRestart should be true when versions differ');
  assert.equal(resultDiff.versions.processVersion, '0.0.1', 'processVersion should be passed value');
});

// ============================================================================
// formatVersionMessage Tests
// ============================================================================

console.log('\n📋 formatVersionMessage Tests\n');

test('formatVersionMessage returns string', () => {
  const versions = {
    hiveMind: '1.23.12',
    node: 'v20.20.0',
    platform: 'linux (x64)',
  };
  const message = formatVersionMessage(versions);
  assert.ok(typeof message === 'string', 'Should return a string');
});

test('formatVersionMessage includes Hive-Mind header', () => {
  const versions = {
    hiveMind: '1.23.12',
    node: 'v20.20.0',
  };
  const message = formatVersionMessage(versions);
  assert.ok(message.includes('*🤖 Hive-Mind*'), 'Should include Hive-Mind header');
  assert.ok(message.includes('1.23.12'), 'Should include version number');
});

test('formatVersionMessage shows restart warning when needsRestart is true', () => {
  const versions = {
    hiveMind: '1.23.12',
    processVersion: '1.22.0',
    needsRestart: true,
    node: 'v20.20.0',
  };
  const message = formatVersionMessage(versions);
  assert.ok(message.includes('restart needed'), 'Should show restart warning');
  assert.ok(message.includes('1.22.0'), 'Should show process version');
});

test('formatVersionMessage does not show restart warning when needsRestart is false', () => {
  const versions = {
    hiveMind: '1.23.12',
    processVersion: '1.23.12',
    needsRestart: false,
    node: 'v20.20.0',
  };
  const message = formatVersionMessage(versions);
  assert.ok(!message.includes('restart needed'), 'Should not show restart warning');
});

test('formatVersionMessage groups JavaScript tools under JavaScript/Node.js section', () => {
  const versions = {
    hiveMind: '1.23.12',
    node: 'v20.20.0',
    bun: '1.3.9',
    deno: 'deno 2.6.9',
    npm: '11.10.0',
  };
  const message = formatVersionMessage(versions);
  assert.ok(message.includes('*📦 JavaScript/Node.js*'), 'Should have JavaScript/Node.js section');
  assert.ok(message.includes('Node.js'), 'Should include Node.js');
  assert.ok(message.includes('Bun'), 'Should include Bun');
  assert.ok(message.includes('Deno'), 'Should include Deno');
});

test('formatVersionMessage groups Python tools under Python section', () => {
  const versions = {
    hiveMind: '1.23.12',
    python: 'Python 3.14.3',
    pyenv: 'pyenv 2.6.22',
  };
  const message = formatVersionMessage(versions);
  assert.ok(message.includes('*🐍 Python*'), 'Should have Python section');
  assert.ok(message.includes('Python'), 'Should include Python');
  assert.ok(message.includes('Pyenv'), 'Should include Pyenv');
});

test('formatVersionMessage groups Rust tools under Rust section', () => {
  const versions = {
    hiveMind: '1.23.12',
    rust: 'rustc 1.93.1',
    cargo: 'cargo 1.93.1',
  };
  const message = formatVersionMessage(versions);
  assert.ok(message.includes('*🦀 Rust*'), 'Should have Rust section');
  assert.ok(message.includes('Rustc'), 'Should include Rustc');
  assert.ok(message.includes('Cargo'), 'Should include Cargo');
});

test('formatVersionMessage groups AI agents under AI Agents section', () => {
  const versions = {
    hiveMind: '1.23.12',
    claudeCode: 'Claude Code 2.1.41',
    agent: 'agent 1.0.0',
    codex: 'codex 1.0.0',
  };
  const message = formatVersionMessage(versions);
  assert.ok(message.includes('*🎭 AI Agents*'), 'Should have AI Agents section');
  assert.ok(message.includes('Claude Code'), 'Should include Claude Code');
  assert.ok(message.includes('Agent CLI'), 'Should include Agent CLI');
  assert.ok(message.includes('Codex'), 'Should include Codex');
});

test('formatVersionMessage groups C/C++ tools under C/C++ section', () => {
  const versions = {
    hiveMind: '1.23.12',
    gcc: 'gcc 13.3.0',
    gpp: 'g++ 13.3.0',
    clang: 'clang 18.1.3',
    cmake: 'cmake 3.28.3',
  };
  const message = formatVersionMessage(versions);
  assert.ok(message.includes('*🔨 C/C++*'), 'Should have C/C++ section');
  assert.ok(message.includes('GCC'), 'Should include GCC');
  assert.ok(message.includes('Clang'), 'Should include Clang');
  assert.ok(message.includes('CMake'), 'Should include CMake');
});

test('formatVersionMessage does not include empty sections', () => {
  const versions = {
    hiveMind: '1.23.12',
    node: 'v20.20.0',
    // No Rust tools
    // No Java tools
  };
  const message = formatVersionMessage(versions);
  assert.ok(!message.includes('*🦀 Rust*'), 'Should not have Rust section when no Rust tools');
  assert.ok(!message.includes('*☕ Java*'), 'Should not have Java section when no Java tools');
});

test('formatVersionMessage includes platform at the end', () => {
  const versions = {
    hiveMind: '1.23.12',
    node: 'v20.20.0',
    platform: 'linux (x64)',
  };
  const message = formatVersionMessage(versions);
  assert.ok(message.includes('*💻 Platform*'), 'Should have Platform section');
  assert.ok(message.includes('linux (x64)'), 'Should include platform info');
  // Platform should be at the end
  const platformIndex = message.indexOf('*💻 Platform*');
  const lastSectionIndex = Math.max(message.indexOf('*🛠 Development Tools*'), message.indexOf('*🔨 C/C++*'), message.indexOf('*🐍 Python*'));
  assert.ok(platformIndex > lastSectionIndex, 'Platform section should be at the end');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(50));
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log('='.repeat(50) + '\n');

if (testsFailed > 0) {
  process.exit(1);
}
