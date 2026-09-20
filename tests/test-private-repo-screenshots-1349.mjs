#!/usr/bin/env node

/**
 * Unit Tests: Issue #1349 - Broken image links in PR descriptions for private repositories
 *
 * Tests verify that:
 * 1. Vision model → screenshot instructions include github.com/blob/?raw=true URL pattern (works for both public and private repos)
 * 2. No vision model → no screenshot section in prompt
 * 3. URL format uses github.com/org/repo/blob/branch/path?raw=true (not raw.githubusercontent.com)
 * 4. Same behavior in all prompt modules: claude, agent, codex, and opencode
 *
 * Run with: node tests/test-private-repo-screenshots-1349.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1349
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { test, printSummary, getFailCount } from './test-helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import all prompt builder functions
let modules;

try {
  modules = {
    claude: await import('../src/claude.prompts.lib.mjs'),
    agent: await import('../src/agent.prompts.lib.mjs'),
    codex: await import('../src/codex.prompts.lib.mjs'),
    opencode: await import('../src/opencode.prompts.lib.mjs'),
  };
} catch (e) {
  console.error(`Failed to import prompt modules: ${e.message}`);
  process.exit(1);
}

// Common base params for tests
const baseParams = {
  owner: 'test-owner',
  repo: 'test-repo',
  issueNumber: '123',
  prNumber: '456',
  branchName: 'test-branch',
  workspaceTmpDir: null,
  argv: {},
};

// ===== Vision model screenshot URL tests for all prompt modules =====
for (const [name, mod] of Object.entries(modules)) {
  const buildSystemPrompt = mod.buildSystemPrompt;

  console.log(`\n📋 Tests for ${name}.prompts.lib.mjs\n`);

  test(`[${name}] Vision model → screenshot section uses github.com/blob/?raw=true URL format`, () => {
    const prompt = buildSystemPrompt({ ...baseParams, modelSupportsVision: true });
    assert.ok(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
    assert.ok(prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should include github.com/blob/ URL with correct owner/repo/branch');
    assert.ok(prompt.includes('?raw=true'), 'Should include ?raw=true suffix');
    assert.ok(!prompt.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com (broken for private repos)');
  });

  test(`[${name}] No vision model → no screenshot section`, () => {
    const prompt = buildSystemPrompt({ ...baseParams, modelSupportsVision: false });
    assert.ok(!prompt.includes('Visual UI work and screenshots'), 'Should not include screenshot section');
  });
}

// Claude and agent have extra assertions about universal wording
for (const name of ['claude', 'agent']) {
  test(`[${name}] Vision model → screenshot section works universally (no private/public distinction)`, () => {
    const prompt = modules[name].buildSystemPrompt({ ...baseParams, modelSupportsVision: true });
    assert.ok(prompt.includes('works for both public and private repositories'), 'Should explicitly state it works for both public and private repositories');
    assert.ok(!prompt.includes('PRIVATE repository'), 'Should NOT have private repo-specific warning');
  });
}

// ===== Source code verification tests =====
console.log('\n📋 Source code verification tests\n');

for (const name of Object.keys(modules)) {
  test(`${name}.prompts.lib.mjs: uses github.com/blob/?raw=true URL format via screenshotRepoPath`, () => {
    const content = readFileSync(join(__dirname, `../src/${name}.prompts.lib.mjs`), 'utf-8');
    assert.ok(content.includes('github.com/${screenshotRepoPath}/blob/${branchName}'), 'Should use github.com/blob/ URL format with screenshotRepoPath');
    assert.ok(content.includes('?raw=true'), 'Should include ?raw=true suffix');
    assert.ok(!content.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com');
  });

  test(`${name}.prompts.lib.mjs: does NOT have repoIsPrivate parameter (simplified approach)`, () => {
    const content = readFileSync(join(__dirname, `../src/${name}.prompts.lib.mjs`), 'utf-8');
    assert.ok(!content.includes('repoIsPrivate'), 'Should NOT have repoIsPrivate parameter (no longer needed)');
  });
}

// Lib files should not use getRepoVisibility
for (const name of ['claude', 'agent']) {
  test(`${name}.lib.mjs: does NOT import or use getRepoVisibility (simplified approach)`, () => {
    const content = readFileSync(join(__dirname, `../src/${name}.lib.mjs`), 'utf-8');
    assert.ok(!content.includes('getRepoVisibility'), `${name}.lib.mjs should NOT import getRepoVisibility (no longer needed)`);
    assert.ok(!content.includes('repoIsPrivate'), `${name}.lib.mjs should NOT use repoIsPrivate`);
  });
}

// ===== Summary =====
printSummary(80);

if (getFailCount() > 0) {
  process.exit(1);
}
