#!/usr/bin/env node

/**
 * Unit Tests: Issue #1349 - Broken image links in PR descriptions for private repositories
 *
 * Tests verify that:
 * 1. Vision model → screenshot instructions include github.com/blob/?raw=true URL pattern (works for both public and private repos)
 * 2. No vision model → no screenshot section in prompt
 * 3. URL format uses github.com/org/repo/blob/branch/path?raw=true (not raw.githubusercontent.com)
 * 4. Same behavior in both claude.prompts.lib.mjs and agent.prompts.lib.mjs
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

// Import the prompt builder functions directly
let claudePrompts;
let agentPrompts;

try {
  claudePrompts = await import('../src/claude.prompts.lib.mjs');
  agentPrompts = await import('../src/agent.prompts.lib.mjs');
} catch (e) {
  console.error(`Failed to import prompt modules: ${e.message}`);
  process.exit(1);
}

const { buildSystemPrompt: claudeBuildSystemPrompt } = claudePrompts;
const { buildSystemPrompt: agentBuildSystemPrompt } = agentPrompts;

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

// ===== Tests for claude.prompts.lib.mjs =====
console.log('\n📋 Tests for claude.prompts.lib.mjs\n');

test('Vision model → screenshot section uses github.com/blob/?raw=true URL format', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
  });

  assert.ok(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
  assert.ok(prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should include github.com/blob/ URL with correct owner/repo/branch');
  assert.ok(prompt.includes('?raw=true'), 'Should include ?raw=true suffix');
  assert.ok(!prompt.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com (broken for private repos)');
});

test('Vision model → screenshot section works universally (no private/public distinction)', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
  });

  assert.ok(prompt.includes('works for both public and private repositories'), 'Should explicitly state it works for both public and private repositories');
  assert.ok(!prompt.includes('PRIVATE repository'), 'Should NOT have private repo-specific warning');
  assert.ok(!prompt.includes('HTTP 404'), 'Should NOT mention HTTP 404 errors');
});

test('No vision model → no screenshot section', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
  });

  assert.ok(!prompt.includes('Visual UI work and screenshots'), 'Should not include screenshot section');
  assert.ok(!prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should not include any screenshot URL');
});

// ===== Tests for agent.prompts.lib.mjs =====
console.log('\n📋 Tests for agent.prompts.lib.mjs\n');

test('[agent] Vision model → screenshot section uses github.com/blob/?raw=true URL format', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
  });

  assert.ok(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
  assert.ok(prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should include github.com/blob/ URL with correct owner/repo/branch');
  assert.ok(prompt.includes('?raw=true'), 'Should include ?raw=true suffix');
  assert.ok(!prompt.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com (broken for private repos)');
});

test('[agent] Vision model → screenshot section works universally (no private/public distinction)', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
  });

  assert.ok(prompt.includes('works for both public and private repositories'), 'Should explicitly state it works for both public and private repositories');
  assert.ok(!prompt.includes('PRIVATE repository'), 'Should NOT have private repo-specific warning');
});

test('[agent] No vision model → no screenshot section', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
  });

  assert.ok(!prompt.includes('Visual UI work and screenshots'), 'Should not include screenshot section');
  assert.ok(!prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should not include any screenshot URL');
});

// ===== Source code verification tests =====
console.log('\n📋 Source code verification tests\n');

test('claude.prompts.lib.mjs: uses github.com/blob/?raw=true URL format via screenshotRepoPath', () => {
  const claudePromptsPath = join(__dirname, '../src/claude.prompts.lib.mjs');
  const content = readFileSync(claudePromptsPath, 'utf-8');
  assert.ok(content.includes('github.com/${screenshotRepoPath}/blob/${branchName}'), 'Should use github.com/blob/ URL format with screenshotRepoPath');
  assert.ok(content.includes('?raw=true'), 'Should include ?raw=true suffix');
  assert.ok(!content.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com');
});

test('agent.prompts.lib.mjs: uses github.com/blob/?raw=true URL format via screenshotRepoPath', () => {
  const agentPromptsPath = join(__dirname, '../src/agent.prompts.lib.mjs');
  const content = readFileSync(agentPromptsPath, 'utf-8');
  assert.ok(content.includes('github.com/${screenshotRepoPath}/blob/${branchName}'), 'Should use github.com/blob/ URL format with screenshotRepoPath');
  assert.ok(content.includes('?raw=true'), 'Should include ?raw=true suffix');
  assert.ok(!content.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com');
});

test('claude.prompts.lib.mjs: does NOT have repoIsPrivate parameter (simplified approach)', () => {
  const claudePromptsPath = join(__dirname, '../src/claude.prompts.lib.mjs');
  const content = readFileSync(claudePromptsPath, 'utf-8');
  assert.ok(!content.includes('repoIsPrivate'), 'Should NOT have repoIsPrivate parameter (no longer needed)');
});

test('agent.prompts.lib.mjs: does NOT have repoIsPrivate parameter (simplified approach)', () => {
  const agentPromptsPath = join(__dirname, '../src/agent.prompts.lib.mjs');
  const content = readFileSync(agentPromptsPath, 'utf-8');
  assert.ok(!content.includes('repoIsPrivate'), 'Should NOT have repoIsPrivate parameter (no longer needed)');
});

test('claude.lib.mjs: does NOT import or use getRepoVisibility (simplified approach)', () => {
  const claudeLibPath = join(__dirname, '../src/claude.lib.mjs');
  const content = readFileSync(claudeLibPath, 'utf-8');
  assert.ok(!content.includes('getRepoVisibility'), 'claude.lib.mjs should NOT import getRepoVisibility (no longer needed)');
  assert.ok(!content.includes('repoIsPrivate'), 'claude.lib.mjs should NOT use repoIsPrivate');
});

test('agent.lib.mjs: does NOT import or use getRepoVisibility (simplified approach)', () => {
  const agentLibPath = join(__dirname, '../src/agent.lib.mjs');
  const content = readFileSync(agentLibPath, 'utf-8');
  assert.ok(!content.includes('getRepoVisibility'), 'agent.lib.mjs should NOT import getRepoVisibility (no longer needed)');
  assert.ok(!content.includes('repoIsPrivate'), 'agent.lib.mjs should NOT use repoIsPrivate');
});

// ===== Summary =====
printSummary(80);

if (getFailCount() > 0) {
  process.exit(1);
}
