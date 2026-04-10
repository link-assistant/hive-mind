#!/usr/bin/env node

/**
 * Unit Tests: Issue #1561 - Broken screenshot attached to pull request in fork mode
 *
 * Tests verify that:
 * 1. Fork mode → screenshot URL uses forked repo path instead of original repo
 * 2. Non-fork mode → screenshot URL uses original owner/repo (unchanged behavior)
 * 3. Same behavior in both claude.prompts.lib.mjs and agent.prompts.lib.mjs
 * 4. Source code uses screenshotRepoPath variable for fork-aware URL generation
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

// Import the prompt builder functions
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
  owner: 'original-owner',
  repo: 'original-repo',
  issueNumber: '1790',
  prNumber: '1796',
  branchName: 'issue-1790-abc123',
  workspaceTmpDir: null,
  modelSupportsVision: true,
};

// ===== Tests for claude.prompts.lib.mjs: Fork mode =====
console.log('\n📋 Claude prompts: Fork mode screenshot URLs\n');

test('Fork mode → screenshot URL uses forked repo path', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    argv: { fork: true },
    forkedRepo: 'fork-user/original-repo',
  });

  assert.ok(prompt.includes('github.com/fork-user/original-repo/blob/issue-1790-abc123'), 'Should use forked repo in screenshot URL');
  assert.ok(!prompt.includes('github.com/original-owner/original-repo/blob/issue-1790-abc123'), 'Should NOT use original repo in screenshot URL when in fork mode');
});

test('Non-fork mode → screenshot URL uses original repo', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    argv: {},
  });

  assert.ok(prompt.includes('github.com/original-owner/original-repo/blob/issue-1790-abc123'), 'Should use original owner/repo in screenshot URL');
});

test('Fork mode without forkedRepo → falls back to original repo', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    argv: { fork: true },
  });

  assert.ok(prompt.includes('github.com/original-owner/original-repo/blob/issue-1790-abc123'), 'Should fall back to original repo when forkedRepo is not available');
});

test('Fork mode with empty argv → uses original repo', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    argv: {},
    forkedRepo: 'fork-user/original-repo',
  });

  assert.ok(prompt.includes('github.com/original-owner/original-repo/blob/issue-1790-abc123'), 'Should use original repo when fork flag is not set');
});

// ===== Tests for agent.prompts.lib.mjs: Fork mode =====
console.log('\n📋 Agent prompts: Fork mode screenshot URLs\n');

test('[agent] Fork mode → screenshot URL uses forked repo path', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    argv: { fork: true },
    forkedRepo: 'fork-user/original-repo',
  });

  assert.ok(prompt.includes('github.com/fork-user/original-repo/blob/issue-1790-abc123'), 'Should use forked repo in screenshot URL');
  assert.ok(!prompt.includes('github.com/original-owner/original-repo/blob/issue-1790-abc123'), 'Should NOT use original repo in screenshot URL when in fork mode');
});

test('[agent] Non-fork mode → screenshot URL uses original repo', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    argv: {},
  });

  assert.ok(prompt.includes('github.com/original-owner/original-repo/blob/issue-1790-abc123'), 'Should use original owner/repo in screenshot URL');
});

test('[agent] Fork mode without forkedRepo → falls back to original repo', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    argv: { fork: true },
  });

  assert.ok(prompt.includes('github.com/original-owner/original-repo/blob/issue-1790-abc123'), 'Should fall back to original repo when forkedRepo is not available');
});

// ===== Source code verification =====
console.log('\n📋 Source code verification\n');

test('claude.prompts.lib.mjs: extracts forkedRepo from params', () => {
  const content = readFileSync(join(__dirname, '../src/claude.prompts.lib.mjs'), 'utf-8');
  assert.ok(content.includes('forkedRepo'), 'Should destructure forkedRepo from params');
  assert.ok(content.includes('screenshotRepoPath'), 'Should compute screenshotRepoPath');
});

test('agent.prompts.lib.mjs: extracts forkedRepo from params', () => {
  const content = readFileSync(join(__dirname, '../src/agent.prompts.lib.mjs'), 'utf-8');
  assert.ok(content.includes('forkedRepo'), 'Should destructure forkedRepo from params');
  assert.ok(content.includes('screenshotRepoPath'), 'Should compute screenshotRepoPath');
});

test('claude.prompts.lib.mjs: screenshotRepoPath uses fork when available', () => {
  const content = readFileSync(join(__dirname, '../src/claude.prompts.lib.mjs'), 'utf-8');
  assert.ok(content.includes('argv?.fork && forkedRepo ? forkedRepo'), 'Should conditionally use forkedRepo when fork mode is active');
});

test('agent.prompts.lib.mjs: screenshotRepoPath uses fork when available', () => {
  const content = readFileSync(join(__dirname, '../src/agent.prompts.lib.mjs'), 'utf-8');
  assert.ok(content.includes('argv?.fork && forkedRepo ? forkedRepo'), 'Should conditionally use forkedRepo when fork mode is active');
});

// ===== Regression: Existing tests from #1349 still hold =====
console.log('\n📋 Regression: Issue #1349 compatibility\n');

test('Vision disabled → no screenshot section (claude)', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
    argv: { fork: true },
    forkedRepo: 'fork-user/original-repo',
  });

  assert.ok(!prompt.includes('Visual UI work and screenshots'), 'Should not include screenshot section without vision');
});

test('Vision disabled → no screenshot section (agent)', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
    argv: { fork: true },
    forkedRepo: 'fork-user/original-repo',
  });

  assert.ok(!prompt.includes('Visual UI work and screenshots'), 'Should not include screenshot section without vision');
});

// ===== Summary =====
printSummary(80);

if (getFailCount() > 0) {
  process.exit(1);
}
