#!/usr/bin/env node

/**
 * Unit Tests: Issue #1561 - Broken screenshot attached to pull request in fork mode
 *
 * Tests verify that:
 * 1. Fork mode → screenshot URL uses forked repo path instead of original repo
 * 2. Non-fork mode → screenshot URL uses original owner/repo (unchanged behavior)
 * 3. Each prompt contains one case-specific screenshot-link example
 * 4. Same behavior in all prompt modules
 * 5. Source code uses screenshotRepoPath variable for fork-aware URL generation
 *
 * Run with: node tests/test-fork-screenshot-url-1561.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1561
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
    gemini: await import('../src/gemini.prompts.lib.mjs'),
    opencode: await import('../src/opencode.prompts.lib.mjs'),
    qwen: await import('../src/qwen.prompts.lib.mjs'),
  };
} catch (e) {
  console.error(`Failed to import prompt modules: ${e.message}`);
  process.exit(1);
}

// Common base params for tests
const baseParams = {
  owner: 'original-owner',
  repo: 'original-repo',
  issueNumber: '1790',
  prNumber: '1796',
  branchName: 'issue-1790-abc123',
  workspaceTmpDir: null,
  modelSupportsVision: true,
};

const forkUrl = 'github.com/fork-user/original-repo/blob/issue-1790-abc123';
const originalUrl = 'github.com/original-owner/original-repo/blob/issue-1790-abc123';
const forkExample = `https://${forkUrl}/docs/screenshots/result.png?raw=true`;
const originalExample = `https://${originalUrl}/docs/screenshots/result.png?raw=true`;
const occurrences = (text, value) => text.split(value).length - 1;
const screenshotLinkExamples = text => text.match(/(?:https:\/\/github\.com\/|gh api repos\/)[^\s)]*docs\/screenshots\/[^\s)]*/gu) || [];

// ===== Fork mode tests for all prompt modules =====
for (const [name, mod] of Object.entries(modules)) {
  const buildSystemPrompt = mod.buildSystemPrompt;

  console.log(`\n📋 ${name} prompts: Fork mode screenshot URLs\n`);

  test(`[${name}] Fork mode → screenshot URL uses forked repo path`, () => {
    const prompt = buildSystemPrompt({ ...baseParams, argv: { fork: true }, forkedRepo: 'fork-user/original-repo' });
    assert.ok(prompt.includes(forkUrl), 'Should use forked repo in screenshot URL');
    assert.ok(!prompt.includes(originalUrl), 'Should NOT use original repo in screenshot URL when in fork mode');
  });

  test(`[${name}] Fork mode → exposes one fork-specific screenshot-link example`, () => {
    const prompt = buildSystemPrompt({ ...baseParams, argv: { fork: true }, forkedRepo: 'fork-user/original-repo' });
    assert.equal(occurrences(prompt, forkExample), 1, 'Should include the working fork URL exactly once');
    assert.equal(screenshotLinkExamples(prompt).length, 1, 'Should not add a second screenshot-link example');
  });

  test(`[${name}] Non-fork mode → screenshot URL uses original repo`, () => {
    const prompt = buildSystemPrompt({ ...baseParams, argv: {} });
    assert.ok(prompt.includes(originalUrl), 'Should use original owner/repo in screenshot URL');
    assert.equal(occurrences(prompt, originalExample), 1, 'Should include the working same-repository URL exactly once');
    assert.equal(screenshotLinkExamples(prompt).length, 1, 'Should not add a second screenshot-link example');
  });

  test(`[${name}] Fork mode without forkedRepo → falls back to original repo`, () => {
    const prompt = buildSystemPrompt({ ...baseParams, argv: { fork: true } });
    assert.ok(prompt.includes(originalUrl), 'Should fall back to original repo when forkedRepo is not available');
  });
}

// Claude-specific: fork flag not set but forkedRepo provided
test('Fork mode with empty argv → uses original repo', () => {
  const prompt = modules.claude.buildSystemPrompt({ ...baseParams, argv: {}, forkedRepo: 'fork-user/original-repo' });
  assert.ok(prompt.includes(originalUrl), 'Should use original repo when fork flag is not set');
});

// ===== Source code verification =====
console.log('\n📋 Source code verification\n');

for (const name of Object.keys(modules)) {
  test(`${name}.prompts.lib.mjs: extracts forkedRepo and computes screenshotRepoPath`, () => {
    const content = readFileSync(join(__dirname, `../src/${name}.prompts.lib.mjs`), 'utf-8');
    assert.ok(content.includes('forkedRepo'), 'Should destructure forkedRepo from params');
    assert.ok(content.includes('screenshotRepoPath'), 'Should compute screenshotRepoPath');
    assert.ok(content.includes('argv?.fork && forkedRepo ? forkedRepo'), 'Should conditionally use forkedRepo when fork mode is active');
  });
}

// ===== Regression: Vision disabled =====
console.log('\n📋 Regression: Issue #1349 compatibility\n');

for (const [name, mod] of Object.entries(modules)) {
  test(`[${name}] Vision disabled → no screenshot section`, () => {
    const prompt = mod.buildSystemPrompt({ ...baseParams, modelSupportsVision: false, argv: { fork: true }, forkedRepo: 'fork-user/original-repo' });
    assert.ok(!prompt.includes('Visual UI work and screenshots'), 'Should not include screenshot section without vision');
  });
}

// ===== Summary =====
printSummary(80);

if (getFailCount() > 0) {
  process.exit(1);
}
