#!/usr/bin/env node
/**
 * Version Information Library Unit Tests
 *
 * Tests for the version-info.lib.mjs module, including:
 * - VERSION_COMMANDS coverage for all expected software categories
 * - formatVersionMessage() output formatting for all sections
 * - getVersionInfo() structure and behavior
 *
 * Run with: node tests/version-info.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1506
 */

import assert from 'node:assert/strict';
import { getVersionInfo, formatVersionMessage } from '../src/version-info.lib.mjs';
import { test, asyncTest, printSummary, getFailCount } from './test-helpers.mjs';

// ============================================================================
// formatVersionMessage Tests - Browser versions (Issue #1506)
// ============================================================================

console.log('\n\ud83d\udccb formatVersionMessage - Browser Versions Tests\n');

test('formatVersionMessage shows Browsers section when browser versions are present', () => {
  const versions = {
    chrome: 'Google Chrome 137.0.7151.55',
    chromium: 'Chromium 137.0.7151.0',
    firefox: 'Mozilla Firefox 139.0',
    msedge: 'Microsoft Edge 137.0.3296.52',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Browsers'), `Expected Browsers section but got: ${result}`);
  assert.ok(result.includes('Google Chrome'), `Expected Google Chrome but got: ${result}`);
  assert.ok(result.includes('Chromium'), `Expected Chromium but got: ${result}`);
  assert.ok(result.includes('Firefox'), `Expected Firefox but got: ${result}`);
  assert.ok(result.includes('Microsoft Edge'), `Expected Microsoft Edge but got: ${result}`);
});

test('formatVersionMessage hides Browsers section when no browsers are installed', () => {
  const versions = { node: 'v24.0.0' };
  const result = formatVersionMessage(versions);
  assert.ok(!result.includes('Browsers'), `Should not have Browsers section when no browsers: ${result}`);
});

test('formatVersionMessage shows partial browser list', () => {
  const versions = { chromium: 'Chromium 137.0.7151.0' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Browsers'), `Expected Browsers section but got: ${result}`);
  assert.ok(result.includes('Chromium'), `Expected Chromium but got: ${result}`);
  assert.ok(!result.includes('Google Chrome'), `Should not show Chrome when not installed: ${result}`);
});

test('formatVersionMessage shows WebKit in Browsers section', () => {
  const versions = { webkit: 'webkit-2248' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Browsers'), `Expected Browsers section but got: ${result}`);
  assert.ok(result.includes('WebKit'), `Expected WebKit but got: ${result}`);
});

// ============================================================================
// formatVersionMessage Tests - Browser Automation section (Issue #1506)
// ============================================================================

console.log('\n\ud83d\udccb formatVersionMessage - Browser Automation Tests\n');

test('formatVersionMessage shows Browser Automation section with all tools', () => {
  const versions = {
    playwright: '1.52.0',
    playwrightTest: '@playwright/test@1.52.0',
    playwrightMcp: '@playwright/mcp@0.0.32',
    puppeteerBrowsers: '@puppeteer/browsers@2.10.5',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Browser Automation'), `Expected Browser Automation section but got: ${result}`);
  assert.ok(result.includes('Playwright Test'), `Expected Playwright Test but got: ${result}`);
  assert.ok(result.includes('Playwright MCP'), `Expected Playwright MCP but got: ${result}`);
  assert.ok(result.includes('Puppeteer Browsers'), `Expected Puppeteer Browsers but got: ${result}`);
});

test('formatVersionMessage shows Playwright MCP status when connected', () => {
  const versions = {
    playwrightMcp: '@playwright/mcp@0.0.32',
    playwrightMcpClaudeStatus: 'playwright: connected',
    playwrightMcpCodexStatus: 'playwright: connected',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Playwright MCP: `0.0.32 | Claude Code: connected | Codex: connected`'), `Expected MCP connected format but got: ${result}`);
});

test('formatVersionMessage shows not connected when MCP installed but not in Claude', () => {
  const versions = {
    playwrightMcp: '@playwright/mcp@0.0.32',
    playwrightMcpClaudeStatus: null,
    playwrightMcpCodexStatus: null,
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Playwright MCP: `0.0.32 | Claude Code: not connected | Codex: not connected`'), `Expected MCP not connected format but got: ${result}`);
});

test('formatVersionMessage separates Playwright from Development Tools', () => {
  const versions = {
    playwright: '1.52.0',
    playwrightMcp: '@playwright/mcp@0.0.32',
    git: 'git version 2.43.0',
  };
  const result = formatVersionMessage(versions);
  // Playwright should be in Browser Automation, not Development Tools
  assert.ok(result.includes('Browser Automation'), `Expected Browser Automation section but got: ${result}`);
  assert.ok(result.includes('Development Tools'), `Expected Development Tools section but got: ${result}`);
  // Git should only be in Development Tools
  const devToolsIdx = result.indexOf('Development Tools');
  const browserAutoIdx = result.indexOf('Browser Automation');
  const gitIdx = result.indexOf('Git');
  assert.ok(gitIdx > devToolsIdx, `Git should be in Development Tools section`);
});

// ============================================================================
// formatVersionMessage Tests - New language runtimes (Issue #1506)
// ============================================================================

console.log('\n\ud83d\udccb formatVersionMessage - New Language Runtimes Tests\n');

test('formatVersionMessage shows Ruby section', () => {
  const versions = {
    ruby: 'ruby 3.3.0 (2023-12-25 revision 5124f9ac75)',
    rbenv: 'rbenv 1.2.0',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Ruby'), `Expected Ruby section but got: ${result}`);
  assert.ok(result.includes('Rbenv'), `Expected Rbenv but got: ${result}`);
});

test('formatVersionMessage shows Kotlin section', () => {
  const versions = { kotlin: 'Kotlin version 2.1.0' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Kotlin'), `Expected Kotlin section but got: ${result}`);
});

test('formatVersionMessage shows Swift section', () => {
  const versions = { swift: 'Swift version 6.1' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Swift'), `Expected Swift section but got: ${result}`);
});

test('formatVersionMessage shows R section', () => {
  const versions = { r: 'R version 4.3.3 (2024-02-29)' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('R'), `Expected R section but got: ${result}`);
});

// ============================================================================
// formatVersionMessage Tests - New dev tools (Issue #1506)
// ============================================================================

console.log('\n\ud83d\udccb formatVersionMessage - New Dev Tools Tests\n');

test('formatVersionMessage shows GitLab CLI in Development Tools', () => {
  const versions = { glab: 'glab version 1.48.0' };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('GitLab CLI'), `Expected GitLab CLI but got: ${result}`);
});

test('formatVersionMessage shows assemblers in C, C++, Assembly section', () => {
  const versions = {
    gcc: 'gcc (Ubuntu 13.3.0-6ubuntu2~24.04) 13.3.0',
    nasm: 'NASM version 2.16.01',
    fasm: 'flat assembler version 1.73.32',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('C, C++, Assembly'), `Expected C, C++, Assembly section but got: ${result}`);
  assert.ok(result.includes('NASM'), `Expected NASM but got: ${result}`);
  assert.ok(result.includes('FASM'), `Expected FASM but got: ${result}`);
});

test('formatVersionMessage shows wget and screen in Development Tools', () => {
  const versions = {
    git: 'git version 2.43.0',
    wget: 'GNU Wget 1.21.4',
    screen: 'Screen version 4.09.01',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('Wget'), `Expected Wget but got: ${result}`);
  assert.ok(result.includes('Screen'), `Expected Screen but got: ${result}`);
});

test('formatVersionMessage shows curl, zip, unzip, expect, xvfb in Development Tools', () => {
  const versions = {
    git: 'git version 2.43.0',
    curl: 'curl 8.5.0',
    zip: 'Zip 3.0',
    unzip: 'UnZip 6.00',
    expect: 'expect version 5.45.4',
    xvfb: 'X.Org X Server 1.21.1.4',
  };
  const result = formatVersionMessage(versions);
  assert.ok(result.includes('cURL'), `Expected cURL but got: ${result}`);
  assert.ok(result.includes('Zip'), `Expected Zip but got: ${result}`);
  assert.ok(result.includes('Unzip'), `Expected Unzip but got: ${result}`);
  assert.ok(result.includes('Expect'), `Expected Expect but got: ${result}`);
  assert.ok(result.includes('Xvfb'), `Expected Xvfb but got: ${result}`);
});

// ============================================================================
// formatVersionMessage Tests - Comprehensive output (Issue #1506)
// ============================================================================

console.log('\n\ud83d\udccb formatVersionMessage - Comprehensive Output Tests\n');

test('formatVersionMessage renders all sections in correct order', () => {
  const versions = {
    hiveMind: '1.39.0',
    claudeCode: '1.0.0',
    node: 'v24.0.0',
    python: 'Python 3.12.0',
    rust: 'rustc 1.82.0',
    java: 'openjdk version "21.0.5"',
    go: 'go version go1.23.4',
    php: 'PHP 8.3.15',
    dotnet: '8.0.404',
    perl: 'v5.38.2',
    ocaml: 'The OCaml toplevel, version 5.2.1',
    lean: 'Lean (version 4.16.0)',
    ruby: 'ruby 3.3.0',
    kotlin: 'Kotlin version 2.1.0',
    swift: 'Swift version 6.1',
    r: 'R version 4.3.3',
    gcc: 'gcc 13.3.0',
    nasm: 'NASM version 2.16.01',
    chrome: 'Google Chrome 137.0',
    firefox: 'Mozilla Firefox 139.0',
    webkit: 'webkit-2248',
    playwright: '1.52.0',
    playwrightMcp: '@playwright/mcp@0.0.32',
    playwrightMcpClaudeStatus: 'playwright: connected',
    playwrightMcpCodexStatus: 'playwright: connected',
    git: 'git version 2.43.0',
    gh: 'gh version 2.65.0',
    glab: 'glab version 1.48.0',
    curl: 'curl 8.5.0',
    wget: 'GNU Wget 1.21.4',
    platform: 'linux (x64)',
  };
  const result = formatVersionMessage(versions);

  // Verify section order using the header markers (with emojis)
  const sectionHeaders = ['*\ud83e\udd16 Hive-Mind*', '*\ud83c\udfad AI Agents*', '*\ud83d\udce6 JavaScript/Node.js*', '*\ud83d\udc0d Python*', '*\ud83e\udd80 Rust*', '*\u2615 Java*', '*\ud83d\udd37 Go*', '*\ud83d\udc18 PHP*', '*\ud83d\udce6 .NET*', '*\ud83d\udc2a Perl*', '*\ud83d\udc2b OCaml/Rocq*', '*\ud83d\udcd0 Lean*', '*\ud83d\udc8e Ruby*', '*\ud83d\udfe3 Kotlin*', '*\ud83e\udd85 Swift*', '*\ud83d\udcca R*', '*\ud83d\udd28 C, C++, Assembly*', '*\ud83c\udf10 Browsers*', '*\ud83c\udfad Browser Automation*', '*\ud83d\udee0 Development Tools*', '*\ud83d\udcbb Platform*'];

  let lastIdx = -1;
  for (const header of sectionHeaders) {
    const idx = result.indexOf(header);
    if (idx === -1) continue; // skip if section not present (some may not appear without data)
    assert.ok(idx > lastIdx, `Section "${header}" (idx=${idx}) should come after previous section (idx=${lastIdx})`);
    lastIdx = idx;
  }
});

// ============================================================================
// getVersionInfo Tests - Structure validation (Issue #1506)
// ============================================================================

console.log('\n\ud83d\udccb getVersionInfo - Structure Tests\n');

await asyncTest('getVersionInfo returns success with expected browser keys', async () => {
  const result = await getVersionInfo(false);
  assert.equal(result.success, true, 'Expected success to be true');
  const v = result.versions;
  // Verify new keys exist (value may be null if software not installed)
  assert.ok('chrome' in v, 'Expected chrome key in versions');
  assert.ok('chromium' in v, 'Expected chromium key in versions');
  assert.ok('firefox' in v, 'Expected firefox key in versions');
  assert.ok('msedge' in v, 'Expected msedge key in versions');
  assert.ok('webkit' in v, 'Expected webkit key in versions');
});

await asyncTest('getVersionInfo returns expected browser automation keys', async () => {
  const result = await getVersionInfo(false);
  const v = result.versions;
  assert.ok('playwrightTest' in v, 'Expected playwrightTest key in versions');
  assert.ok('playwrightMcpClaudeStatus' in v, 'Expected playwrightMcpClaudeStatus key in versions');
  assert.ok('playwrightMcpCodexStatus' in v, 'Expected playwrightMcpCodexStatus key in versions');
  assert.ok('puppeteerBrowsers' in v, 'Expected puppeteerBrowsers key in versions');
});

await asyncTest('getVersionInfo returns expected language runtime keys', async () => {
  const result = await getVersionInfo(false);
  const v = result.versions;
  assert.ok('ruby' in v, 'Expected ruby key in versions');
  assert.ok('rbenv' in v, 'Expected rbenv key in versions');
  assert.ok('kotlin' in v, 'Expected kotlin key in versions');
  assert.ok('swift' in v, 'Expected swift key in versions');
  assert.ok('r' in v, 'Expected r key in versions');
});

await asyncTest('getVersionInfo returns expected dev tool keys', async () => {
  const result = await getVersionInfo(false);
  const v = result.versions;
  assert.ok('glab' in v, 'Expected glab key in versions');
  assert.ok('nasm' in v, 'Expected nasm key in versions');
  assert.ok('fasm' in v, 'Expected fasm key in versions');
  assert.ok('curl' in v, 'Expected curl key in versions');
  assert.ok('wget' in v, 'Expected wget key in versions');
  assert.ok('zip' in v, 'Expected zip key in versions');
  assert.ok('unzip' in v, 'Expected unzip key in versions');
  assert.ok('expect' in v, 'Expected expect key in versions');
  assert.ok('screen' in v, 'Expected screen key in versions');
  assert.ok('xvfb' in v, 'Expected xvfb key in versions');
});

await asyncTest('getVersionInfo gatherTimeMs is reasonable', async () => {
  const result = await getVersionInfo(false);
  assert.ok(result.gatherTimeMs >= 0, 'Expected non-negative gatherTimeMs');
  assert.ok(result.gatherTimeMs < 30000, `Expected gatherTimeMs < 30s but got ${result.gatherTimeMs}ms`);
});

// ============================================================================
// Summary
// ============================================================================

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
