#!/usr/bin/env node
/**
 * Version Parsing Unit Tests
 *
 * Tests for the parseVersion() function in version-info.lib.mjs
 * Validates that all raw --version output strings are normalized to uniform format:
 *   <version> (<commit>, <revision>, <date>, etc.)
 *
 * Run with: node tests/test-version-parsing.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1514
 */

import assert from 'node:assert/strict';
import { parseVersion, formatVersionMessage } from '../src/version-info.lib.mjs';

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

// ============================================================================
// parseVersion Tests — Rust ecosystem
// ============================================================================

console.log('\n📋 parseVersion - Rust ecosystem\n');

test('parseVersion: rustc with commit and date', () => {
  const result = parseVersion('rust', 'rustc 1.94.1 (e408947bf 2026-03-25)');
  assert.equal(result, '1.94.1 (e408947bf, 2026-03-25)');
});

test('parseVersion: cargo with commit and date', () => {
  const result = parseVersion('cargo', 'cargo 1.94.1 (29ea6fb6a 2026-03-24)');
  assert.equal(result, '1.94.1 (29ea6fb6a, 2026-03-24)');
});

// ============================================================================
// parseVersion Tests — Go
// ============================================================================

console.log('\n📋 parseVersion - Go\n');

test('parseVersion: go version with platform', () => {
  const result = parseVersion('go', 'go version go1.26.1 linux/amd64');
  assert.equal(result, '1.26.1 (linux/amd64)');
});

// ============================================================================
// parseVersion Tests — PHP
// ============================================================================

console.log('\n📋 parseVersion - PHP\n');

test('parseVersion: PHP with cli, built date, NTS', () => {
  const result = parseVersion('php', 'PHP 8.3.30 (cli) (built: Jan 13 2026 22:36:55) (NTS)');
  assert.equal(result, '8.3.30 (cli, built: Jan 13 2026 22:36:55, NTS)');
});

// ============================================================================
// parseVersion Tests — Java
// ============================================================================

console.log('\n📋 parseVersion - Java\n');

test('parseVersion: openjdk with date and LTS', () => {
  const result = parseVersion('java', 'openjdk version "21" 2023-09-19 LTS');
  assert.equal(result, '21 (2023-09-19 LTS)');
});

test('parseVersion: openjdk with detailed version', () => {
  const result = parseVersion('java', 'openjdk version "21.0.5" 2024-10-15');
  assert.equal(result, '21.0.5 (2024-10-15)');
});

// ============================================================================
// parseVersion Tests — C/C++ tools
// ============================================================================

console.log('\n📋 parseVersion - C/C++ tools\n');

test('parseVersion: gcc with Ubuntu distro info', () => {
  const result = parseVersion('gcc', 'gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0');
  assert.equal(result, '13.3.0 (Ubuntu 13.3.0-6ubuntu2~24.04.1)');
});

test('parseVersion: g++ with Ubuntu distro info', () => {
  const result = parseVersion('gpp', 'g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0');
  assert.equal(result, '13.3.0 (Ubuntu 13.3.0-6ubuntu2~24.04.1)');
});

test('parseVersion: clang with git URL', () => {
  const result = parseVersion('clang', 'clang version 17.0.0 (https://github.com/swiftlang/llvm-project.git abc123)');
  assert.equal(result, '17.0.0 (https://github.com/swiftlang/llvm-project.git abc123)');
});

test('parseVersion: LLD with compat info', () => {
  const result = parseVersion('lld', 'LLD 17.0.0 (compatible with GNU linkers)');
  assert.equal(result, '17.0.0 (compatible with GNU linkers)');
});

test('parseVersion: LLD plain version', () => {
  const result = parseVersion('lld', 'LLD 18.1.3');
  assert.equal(result, '18.1.3');
});

test('parseVersion: cmake', () => {
  assert.equal(parseVersion('cmake', 'cmake version 3.28.3'), '3.28.3');
});

test('parseVersion: make', () => {
  assert.equal(parseVersion('make', 'GNU Make 4.3'), '4.3');
});

test('parseVersion: nasm', () => {
  assert.equal(parseVersion('nasm', 'NASM version 2.16.01'), '2.16.01');
});

test('parseVersion: fasm', () => {
  assert.equal(parseVersion('fasm', 'flat assembler  version 1.73.32'), '1.73.32');
});

// ============================================================================
// parseVersion Tests — Python
// ============================================================================

console.log('\n📋 parseVersion - Python\n');

test('parseVersion: Python', () => {
  assert.equal(parseVersion('python', 'Python 3.14.3'), '3.14.3');
});

test('parseVersion: pyenv', () => {
  assert.equal(parseVersion('pyenv', 'pyenv 2.6.26'), '2.6.26');
});

// ============================================================================
// parseVersion Tests — Ruby
// ============================================================================

console.log('\n📋 parseVersion - Ruby\n');

test('parseVersion: ruby with revision and platform', () => {
  const result = parseVersion('ruby', 'ruby 3.4.9 (2026-03-11 revision 76cca827ab) +PRISM [x86_64-linux]');
  assert.equal(result, '3.4.9 (2026-03-11 revision 76cca827ab, +PRISM [x86_64-linux])');
});

test('parseVersion: rbenv', () => {
  assert.equal(parseVersion('rbenv', 'rbenv 1.3.2-20-g23c3041'), '1.3.2-20-g23c3041');
});

// ============================================================================
// parseVersion Tests — Kotlin / Swift / R
// ============================================================================

console.log('\n📋 parseVersion - Kotlin, Swift, R\n');

test('parseVersion: kotlin with JRE', () => {
  const result = parseVersion('kotlin', 'Kotlin version 2.3.20-release-208 (JRE 21+35-LTS)');
  assert.equal(result, '2.3.20-release-208 (JRE 21+35-LTS)');
});

test('parseVersion: swift with release tag', () => {
  const result = parseVersion('swift', 'Swift version 6.0.3 (swift-6.0.3-RELEASE)');
  assert.equal(result, '6.0.3 (swift-6.0.3-RELEASE)');
});

test('parseVersion: R with date and codename', () => {
  const result = parseVersion('r', 'R version 4.3.3 (2024-02-29) -- "Angel Food Cake"');
  assert.equal(result, '4.3.3 (2024-02-29, Angel Food Cake)');
});

// ============================================================================
// parseVersion Tests — Dev tools
// ============================================================================

console.log('\n📋 parseVersion - Development tools\n');

test('parseVersion: git', () => {
  assert.equal(parseVersion('git', 'git version 2.43.0'), '2.43.0');
});

test('parseVersion: gh with date', () => {
  assert.equal(parseVersion('gh', 'gh version 2.89.0 (2026-03-26)'), '2.89.0 (2026-03-26)');
});

test('parseVersion: glab', () => {
  assert.equal(parseVersion('glab', 'glab version 1.36.0'), '1.36.0');
});

test('parseVersion: curl with platform', () => {
  assert.equal(parseVersion('curl', 'curl 8.19.0 (x86_64-pc-linux-gnu) libcurl/8.19.0'), '8.19.0 (x86_64-pc-linux-gnu)');
});

test('parseVersion: wget', () => {
  assert.equal(parseVersion('wget', 'GNU Wget 1.21.4 built on linux-gnu.'), '1.21.4');
});

test('parseVersion: screen with GNU and date', () => {
  assert.equal(parseVersion('screen', 'Screen version 4.09.01 (GNU) 20-Aug-23'), '4.09.01 (GNU, 20-Aug-23)');
});

test('parseVersion: expect', () => {
  assert.equal(parseVersion('expect', 'expect version 5.45.4'), '5.45.4');
});

test('parseVersion: zip with date', () => {
  assert.equal(parseVersion('zip', 'This is Zip 3.0 (July 5th 2008), by Info-ZIP.'), '3.0 (July 5th 2008)');
});

test('parseVersion: unzip with date', () => {
  assert.equal(parseVersion('unzip', 'UnZip 6.00 of 20 April 2009, by Debian. Original by Info-ZIP.'), '6.00 (20 April 2009)');
});

test('parseVersion: homebrew', () => {
  assert.equal(parseVersion('brew', 'Homebrew 5.1.2'), '5.1.2');
});

// ============================================================================
// parseVersion Tests — Xvfb (dpkg format)
// ============================================================================

console.log('\n📋 parseVersion - Xvfb\n');

test('parseVersion: xvfb from dpkg output', () => {
  const result = parseVersion('xvfb', "ii  xvfb           2:21.1.12-1ubuntu1.5 amd64        Virtual Framebuffer 'fake' X server");
  assert.equal(result, '21.1.12-1ubuntu1.5');
});

test('parseVersion: xvfb X.Org format', () => {
  const result = parseVersion('xvfb', 'X.Org X Server 1.21.1.4');
  assert.equal(result, '1.21.1.4');
});

// ============================================================================
// parseVersion Tests — OCaml/Lean ecosystem
// ============================================================================

console.log('\n📋 parseVersion - OCaml, Lean\n');

test('parseVersion: ocaml', () => {
  assert.equal(parseVersion('ocaml', 'The OCaml toplevel, version 5.4.1'), '5.4.1');
});

test('parseVersion: rocq', () => {
  assert.equal(parseVersion('rocq', 'The Rocq Prover, version 9.1.1'), '9.1.1');
});

test('parseVersion: elan with commit and date', () => {
  const result = parseVersion('elan', 'elan 4.2.1 (3d5138e15 2026-03-18)');
  assert.equal(result, '4.2.1 (3d5138e15, 2026-03-18)');
});

test('parseVersion: lean with platform and commit', () => {
  const result = parseVersion('lean', 'Lean (version 4.29.0, x86_64-unknown-linux-gnu, commit 98dc76e3c0a9b856c9b98726b713fb04fab16740, Release)');
  assert.equal(result, '4.29.0 (x86_64-unknown-linux-gnu, commit 98dc76e3c0a9b856c9b98726b713fb04fab16740, Release)');
});

// ============================================================================
// parseVersion Tests — AI agents and browsers
// ============================================================================

console.log('\n📋 parseVersion - AI agents, browsers\n');

test('parseVersion: claude code', () => {
  assert.equal(parseVersion('claudeCode', '2.1.87 (Claude Code)'), '2.1.87 (Claude Code)');
});

test('parseVersion: copilot strips trailing dot', () => {
  assert.equal(parseVersion('copilot', 'GitHub Copilot CLI 1.0.14.'), '1.0.14');
});

test('parseVersion: deno with build info', () => {
  const result = parseVersion('deno', 'deno 2.7.9 (stable, release, x86_64-unknown-linux-gnu)');
  assert.equal(result, '2.7.9 (stable, release, x86_64-unknown-linux-gnu)');
});

test('parseVersion: playwright', () => {
  assert.equal(parseVersion('playwright', 'Version 1.58.2'), '1.58.2');
});

test('parseVersion: playwright mcp from npm list', () => {
  assert.equal(parseVersion('playwrightMcp', '`-- @playwright/mcp@0.0.69'), '0.0.69');
});

test('parseVersion: chrome', () => {
  assert.equal(parseVersion('chrome', 'Google Chrome 146.0.7680.164'), '146.0.7680.164');
});

test('parseVersion: msedge', () => {
  assert.equal(parseVersion('msedge', 'Microsoft Edge 146.0.3856.84'), '146.0.3856.84');
});

test('parseVersion: perlbrew from full path', () => {
  assert.equal(parseVersion('perlbrew', '/workspace/.perl5/bin/perlbrew  - App::perlbrew/1.02'), '1.02');
});

// ============================================================================
// parseVersion Tests — Edge cases
// ============================================================================

console.log('\n📋 parseVersion - Edge cases\n');

test('parseVersion: null input returns null', () => {
  assert.equal(parseVersion('rust', null), null);
});

test('parseVersion: empty string returns empty', () => {
  assert.equal(parseVersion('rust', ''), '');
});

test('parseVersion: unknown key returns raw string', () => {
  assert.equal(parseVersion('unknownTool', 'some output'), 'some output');
});

test('parseVersion: non-matching output returns raw string', () => {
  assert.equal(parseVersion('rust', 'totally unexpected output'), 'totally unexpected output');
});

// ============================================================================
// formatVersionMessage Tests — Playwright MCP new format (Issue #1514)
// ============================================================================

console.log('\n📋 formatVersionMessage - Playwright MCP format (Issue #1514)\n');

test('formatVersionMessage shows Playwright MCP with connected status', () => {
  const versions = {
    playwrightMcp: '@playwright/mcp@0.0.69',
    playwrightMcpStatus: 'playwright: npx ... - ✓ Connected',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Playwright MCP: `0.0.69 (Claude Code: connected)`'), `Expected new MCP format but got: ${result}`);
});

test('formatVersionMessage shows Playwright MCP with not connected status', () => {
  const versions = {
    playwrightMcp: '@playwright/mcp@0.0.69',
    playwrightMcpStatus: null,
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Playwright MCP: `0.0.69 (Claude Code: not connected)`'), `Expected not connected format but got: ${result}`);
});

test('formatVersionMessage does not show Playwright MCP when not installed', () => {
  const versions = {
    playwrightMcp: null,
    playwrightMcpStatus: null,
  };
  const result = formatVersionMessage(versions);
  assert.ok(!result.includes('Playwright MCP'), `Should not show Playwright MCP when not installed: ${result}`);
});

// ============================================================================
// formatVersionMessage Tests — Parsed versions in output (Issue #1514)
// ============================================================================

console.log('\n📋 formatVersionMessage - Parsed version output (Issue #1514)\n');

test('formatVersionMessage shows parsed rustc version', () => {
  const versions = { rust: 'rustc 1.94.1 (e408947bf 2026-03-25)' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('1.94.1 (e408947bf, 2026-03-25)'), `Expected parsed version but got: ${result}`);
});

test('formatVersionMessage shows parsed gcc version', () => {
  const versions = { gcc: 'gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('13.3.0 (Ubuntu 13.3.0-6ubuntu2~24.04.1)'), `Expected parsed version but got: ${result}`);
});

test('formatVersionMessage shows parsed LLD version', () => {
  const versions = { lld: 'LLD 17.0.0 (compatible with GNU linkers)' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('17.0.0 (compatible with GNU linkers)'), `Expected parsed LLD version but got: ${result}`);
});

test('formatVersionMessage shows parsed xvfb version from dpkg', () => {
  const versions = { xvfb: 'ii  xvfb           2:21.1.12-1ubuntu1.5 amd64        Virtual Framebuffer' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('21.1.12-1ubuntu1.5'), `Expected parsed xvfb version but got: ${result}`);
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
