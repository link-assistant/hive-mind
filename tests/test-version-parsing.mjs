#!/usr/bin/env node
/**
 * Version Parsing Unit Tests
 *
 * Tests for the parseVersion() and normalizeDate() functions in version-info.lib.mjs
 * Validates that all raw --version output strings are normalized to uniform format:
 *   <version> (<commit>, <date>, etc.)
 *
 * Standardization rules (issue #1524):
 *   - Strip OS/architecture info from version strings
 *   - Normalize dates to ISO format (YYYY-MM-DD)
 *   - Remove meaningless/redundant data (e.g. "swift-6.0.3-RELEASE", "Claude Code")
 *   - Remove URLs, keep only commit hashes
 *   - Use base version only for distro-specific packages (strip -ubuntu, etc.)
 *
 * Run with: node tests/test-version-parsing.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1514
 * @see https://github.com/link-assistant/hive-mind/issues/1524
 */

import assert from 'node:assert/strict';
import { parseVersion, formatVersionMessage, normalizeDate } from '../src/version-info.lib.mjs';
import { test, printSummary, getFailCount } from './test-helpers.mjs';

// ============================================================================
// normalizeDate Tests (issue #1524)
// ============================================================================

console.log('\n📋 normalizeDate\n');

test('normalizeDate: ISO passthrough', () => {
  assert.equal(normalizeDate('2024-02-29'), '2024-02-29');
});

test('normalizeDate: DD-Mon-YY format', () => {
  assert.equal(normalizeDate('20-Aug-23'), '2023-08-20');
});

test('normalizeDate: DD Month YYYY format', () => {
  assert.equal(normalizeDate('20 April 2009'), '2009-04-20');
});

test('normalizeDate: Month DDth YYYY format', () => {
  assert.equal(normalizeDate('July 5th 2008'), '2008-07-05');
});

test('normalizeDate: Month DD YYYY format', () => {
  assert.equal(normalizeDate('Jan 13 2026'), '2026-01-13');
});

test('normalizeDate: Month DD YYYY HH:MM:SS format', () => {
  assert.equal(normalizeDate('Jan 13 2026 22:36:55'), '2026-01-13 22:36:55');
});

test('normalizeDate: null returns null', () => {
  assert.equal(normalizeDate(null), null);
});

test('normalizeDate: unrecognized string passthrough', () => {
  assert.equal(normalizeDate('unknown date'), 'unknown date');
});

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
// parseVersion Tests — Go (issue #1524: strip platform/arch)
// ============================================================================

console.log('\n📋 parseVersion - Go\n');

test('parseVersion: go version strips platform/arch', () => {
  const result = parseVersion('go', 'go version go1.26.1 linux/amd64');
  assert.equal(result, '1.26.1');
});

// ============================================================================
// parseVersion Tests — PHP (issue #1524: strip cli, normalize date)
// ============================================================================

console.log('\n📋 parseVersion - PHP\n');

test('parseVersion: PHP strips cli, normalizes date', () => {
  const result = parseVersion('php', 'PHP 8.3.30 (cli) (built: Jan 13 2026 22:36:55) (NTS)');
  assert.equal(result, '8.3.30 (2026-01-13 22:36:55, NTS)');
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
// parseVersion Tests — C/C++ tools (issue #1524: base version only)
// ============================================================================

console.log('\n📋 parseVersion - C/C++ tools\n');

test('parseVersion: gcc strips distro suffix, uses base version', () => {
  const result = parseVersion('gcc', 'gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0');
  assert.equal(result, '13.3.0');
});

test('parseVersion: g++ strips distro suffix, uses base version', () => {
  const result = parseVersion('gpp', 'g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0');
  assert.equal(result, '13.3.0');
});

test('parseVersion: clang strips URL, keeps commit hash', () => {
  const result = parseVersion('clang', 'clang version 17.0.0 (https://github.com/swiftlang/llvm-project.git 2e6139970eda445d9c6872c0ca293088b4e63dd2)');
  assert.equal(result, '17.0.0 (2e6139970eda445d9c6872c0ca293088b4e63dd2)');
});

test('parseVersion: clang plain version without parens', () => {
  const result = parseVersion('clang', 'clang version 18.1.3');
  assert.equal(result, '18.1.3');
});

test('parseVersion: LLD with compat info outputs just version', () => {
  const result = parseVersion('lld', 'LLD 17.0.0 (compatible with GNU linkers)');
  assert.equal(result, '17.0.0');
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
// parseVersion Tests — Ruby (issue #1524: strip arch, reorder commit/date)
// ============================================================================

console.log('\n📋 parseVersion - Ruby\n');

test('parseVersion: ruby strips arch, reorders to commit then date', () => {
  const result = parseVersion('ruby', 'ruby 3.4.9 (2026-03-11 revision 76cca827ab) +PRISM [x86_64-linux]');
  assert.equal(result, '3.4.9 (76cca827ab, 2026-03-11, +PRISM)');
});

test('parseVersion: rbenv', () => {
  assert.equal(parseVersion('rbenv', 'rbenv 1.3.2-20-g23c3041'), '1.3.2-20-g23c3041');
});

// ============================================================================
// parseVersion Tests — Kotlin / Swift / R (issue #1524: strip meaningless data)
// ============================================================================

console.log('\n📋 parseVersion - Kotlin, Swift, R\n');

test('parseVersion: kotlin strips release build number', () => {
  const result = parseVersion('kotlin', 'Kotlin version 2.3.20-release-208 (JRE 21+35-LTS)');
  assert.equal(result, '2.3.20 (JRE 21+35-LTS)');
});

test('parseVersion: swift strips redundant release tag', () => {
  const result = parseVersion('swift', 'Swift version 6.0.3 (swift-6.0.3-RELEASE)');
  assert.equal(result, '6.0.3');
});

test('parseVersion: R with date and codename', () => {
  const result = parseVersion('r', 'R version 4.3.3 (2024-02-29) -- "Angel Food Cake"');
  assert.equal(result, '4.3.3 (2024-02-29, Angel Food Cake)');
});

// ============================================================================
// parseVersion Tests — Dev tools (issue #1524: strip arch, normalize dates)
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

test('parseVersion: curl strips platform/arch', () => {
  assert.equal(parseVersion('curl', 'curl 8.19.0 (x86_64-pc-linux-gnu) libcurl/8.19.0'), '8.19.0');
});

test('parseVersion: wget', () => {
  assert.equal(parseVersion('wget', 'GNU Wget 1.21.4 built on linux-gnu.'), '1.21.4');
});

test('parseVersion: screen normalizes date, strips GNU', () => {
  assert.equal(parseVersion('screen', 'Screen version 4.09.01 (GNU) 20-Aug-23'), '4.09.01 (2023-08-20)');
});

test('parseVersion: expect', () => {
  assert.equal(parseVersion('expect', 'expect version 5.45.4'), '5.45.4');
});

test('parseVersion: zip normalizes date', () => {
  assert.equal(parseVersion('zip', 'This is Zip 3.0 (July 5th 2008), by Info-ZIP.'), '3.0 (2008-07-05)');
});

test('parseVersion: unzip normalizes date', () => {
  assert.equal(parseVersion('unzip', 'UnZip 6.00 of 20 April 2009, by Debian. Original by Info-ZIP.'), '6.00 (2009-04-20)');
});

test('parseVersion: homebrew', () => {
  assert.equal(parseVersion('brew', 'Homebrew 5.1.2'), '5.1.2');
});

// ============================================================================
// parseVersion Tests — Xvfb (issue #1524: strip distro suffix)
// ============================================================================

console.log('\n📋 parseVersion - Xvfb\n');

test('parseVersion: xvfb from dpkg strips distro suffix', () => {
  const result = parseVersion('xvfb', "ii  xvfb           2:21.1.12-1ubuntu1.5 amd64        Virtual Framebuffer 'fake' X server");
  assert.equal(result, '21.1.12');
});

test('parseVersion: xvfb X.Org format', () => {
  const result = parseVersion('xvfb', 'X.Org X Server 1.21.1.4');
  assert.equal(result, '1.21.1.4');
});

// ============================================================================
// parseVersion Tests — OCaml/Lean ecosystem (issue #1524: strip arch/Release)
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

test('parseVersion: lean strips arch and Release', () => {
  const result = parseVersion('lean', 'Lean (version 4.29.0, x86_64-unknown-linux-gnu, commit 98dc76e3c0a9b856c9b98726b713fb04fab16740, Release)');
  assert.equal(result, '4.29.0 (commit 98dc76e3c0a9b856c9b98726b713fb04fab16740)');
});

// ============================================================================
// parseVersion Tests — AI agents and browsers (issue #1524: strip redundant data)
// ============================================================================

console.log('\n📋 parseVersion - AI agents, browsers\n');

test('parseVersion: claude code strips product name', () => {
  assert.equal(parseVersion('claudeCode', '2.1.87 (Claude Code)'), '2.1.87');
});

test('parseVersion: claude code plain version', () => {
  assert.equal(parseVersion('claudeCode', '2.1.92'), '2.1.92');
});

test('parseVersion: copilot strips trailing dot', () => {
  assert.equal(parseVersion('copilot', 'GitHub Copilot CLI 1.0.14.'), '1.0.14');
});

test('parseVersion: deno keeps only channel, strips arch', () => {
  const result = parseVersion('deno', 'deno 2.7.9 (stable, release, x86_64-unknown-linux-gnu)');
  assert.equal(result, '2.7.9 (stable)');
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
// formatVersionMessage Tests — Playwright MCP format (Issue #1514)
// ============================================================================

console.log('\n📋 formatVersionMessage - Playwright MCP format (Issue #1514)\n');

test('formatVersionMessage shows Playwright MCP with connected status', () => {
  const versions = {
    playwrightMcp: '@playwright/mcp@0.0.69',
    playwrightMcpClaudeStatus: 'playwright: npx ... - ✓ Connected',
    playwrightMcpCodexStatus: 'playwright enabled',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Playwright MCP: `0.0.69 | Claude Code: connected | Codex: connected`'), `Expected new MCP format but got: ${result}`);
});

test('formatVersionMessage shows Playwright MCP with not connected status', () => {
  const versions = {
    playwrightMcp: '@playwright/mcp@0.0.69',
    playwrightMcpClaudeStatus: null,
    playwrightMcpCodexStatus: null,
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Playwright MCP: `0.0.69 | Claude Code: not connected | Codex: not connected`'), `Expected not connected format but got: ${result}`);
});

test('formatVersionMessage does not show Playwright MCP when not installed', () => {
  const versions = {
    playwrightMcp: null,
    playwrightMcpClaudeStatus: null,
    playwrightMcpCodexStatus: null,
  };
  const result = formatVersionMessage(versions);
  assert.ok(!result.includes('Playwright MCP'), `Should not show Playwright MCP when not installed: ${result}`);
});

// ============================================================================
// formatVersionMessage Tests — Parsed versions in output (Issue #1514, #1524)
// ============================================================================

console.log('\n📋 formatVersionMessage - Parsed version output (Issue #1514, #1524)\n');

test('formatVersionMessage shows parsed rustc version', () => {
  const versions = { rust: 'rustc 1.94.1 (e408947bf 2026-03-25)' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('1.94.1 (e408947bf, 2026-03-25)'), `Expected parsed version but got: ${result}`);
});

test('formatVersionMessage shows base gcc version without distro suffix', () => {
  const versions = { gcc: 'gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('`13.3.0`'), `Expected base version but got: ${result}`);
  assert.ok(!result.includes('ubuntu'), `Should not include distro suffix but got: ${result}`);
});

test('formatVersionMessage shows parsed LLD version without compat info', () => {
  const versions = { lld: 'LLD 17.0.0 (compatible with GNU linkers)' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('17.0.0'), `Expected LLD version but got: ${result}`);
  assert.ok(!result.includes('compatible with GNU linkers'), `Should not include compat info but got: ${result}`);
});

test('formatVersionMessage shows base xvfb version without distro suffix', () => {
  const versions = { xvfb: 'ii  xvfb           2:21.1.12-1ubuntu1.5 amd64        Virtual Framebuffer' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('`21.1.12`'), `Expected base version but got: ${result}`);
  assert.ok(!result.includes('ubuntu'), `Should not include distro suffix but got: ${result}`);
});

// ============================================================================
// formatVersionMessage Tests — Section headers (Issue #1524)
// ============================================================================

console.log('\n📋 formatVersionMessage - Section headers (Issue #1524)\n');

test('formatVersionMessage uses "C, C++, Assembly" header (no /Assembly)', () => {
  const versions = { gcc: 'gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('C, C++, Assembly'), `Expected "C, C++, Assembly" header but got: ${result}`);
  assert.ok(!result.includes('C/C++/Assembly'), `Should not contain /Assembly but got: ${result}`);
});

// ============================================================================
// formatVersionMessage Tests — Platform detection (Issue #1524)
// ============================================================================

console.log('\n📋 formatVersionMessage - Platform detection (Issue #1524)\n');

test('formatVersionMessage shows detailed platform info', () => {
  const versions = {
    platformEnvironment: 'docker container',
    platformArch: 'AMD64 (x86-64)',
    platformOs: 'Ubuntu 24.04.1 LTS',
    platformKernel: 'Linux 6.8.0-94-generic',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Environment: `docker container`'), `Expected environment but got: ${result}`);
  assert.ok(result.includes('Architecture: `AMD64 (x86-64)`'), `Expected architecture but got: ${result}`);
  assert.ok(result.includes('OS: `Ubuntu 24.04.1 LTS`'), `Expected OS but got: ${result}`);
  assert.ok(result.includes('Kernel: `Linux 6.8.0-94-generic`'), `Expected kernel but got: ${result}`);
});

test('formatVersionMessage falls back to legacy platform format', () => {
  const versions = { platform: 'linux (x64)' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('System: `linux (x64)`'), `Expected fallback format but got: ${result}`);
});

// ============================================================================
// Summary
// ============================================================================

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
