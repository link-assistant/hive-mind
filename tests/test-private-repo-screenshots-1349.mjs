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

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1349 - Broken image links in PR descriptions for private repos');
console.log('================================================================================\n');

// Import the prompt builder functions directly
// We use dynamic import so we can test with real module
let claudePrompts;
let agentPrompts;

try {
  claudePrompts = await import('../src/claude.prompts.lib.mjs');
  agentPrompts = await import('../src/agent.prompts.lib.mjs');
} catch (e) {
  console.error(`${RED}❌ Failed to import prompt modules: ${e.message}${RESET}`);
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
console.log(`${BLUE}📋 Tests for claude.prompts.lib.mjs${RESET}\n`);

test('Vision model → screenshot section uses github.com/blob/?raw=true URL format', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
  });

  assert(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
  assert(prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should include github.com/blob/ URL with correct owner/repo/branch');
  assert(prompt.includes('?raw=true'), 'Should include ?raw=true suffix');
  assert(!prompt.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com (broken for private repos)');
});

test('Vision model → screenshot section works universally (no private/public distinction)', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
  });

  assert(prompt.includes('works for both public and private repositories'), 'Should explicitly state it works for both public and private repositories');
  assert(!prompt.includes('PRIVATE repository'), 'Should NOT have private repo-specific warning');
  assert(!prompt.includes('HTTP 404'), 'Should NOT mention HTTP 404 errors');
});

test('No vision model → no screenshot section', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
  });

  assert(!prompt.includes('Visual UI work and screenshots'), 'Should not include screenshot section');
  assert(!prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should not include any screenshot URL');
});

// ===== Tests for agent.prompts.lib.mjs =====
console.log(`\n${BLUE}📋 Tests for agent.prompts.lib.mjs${RESET}\n`);

test('[agent] Vision model → screenshot section uses github.com/blob/?raw=true URL format', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
  });

  assert(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
  assert(prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should include github.com/blob/ URL with correct owner/repo/branch');
  assert(prompt.includes('?raw=true'), 'Should include ?raw=true suffix');
  assert(!prompt.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com (broken for private repos)');
});

test('[agent] Vision model → screenshot section works universally (no private/public distinction)', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
  });

  assert(prompt.includes('works for both public and private repositories'), 'Should explicitly state it works for both public and private repositories');
  assert(!prompt.includes('PRIVATE repository'), 'Should NOT have private repo-specific warning');
});

test('[agent] No vision model → no screenshot section', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
  });

  assert(!prompt.includes('Visual UI work and screenshots'), 'Should not include screenshot section');
  assert(!prompt.includes('github.com/test-owner/test-repo/blob/test-branch'), 'Should not include any screenshot URL');
});

// ===== Source code verification tests =====
console.log(`\n${BLUE}📋 Source code verification tests${RESET}\n`);

test('claude.prompts.lib.mjs: uses github.com/blob/?raw=true URL format', () => {
  const claudePromptsPath = join(__dirname, '../src/claude.prompts.lib.mjs');
  const content = readFileSync(claudePromptsPath, 'utf-8');
  assert(content.includes('github.com/${owner}/${repo}/blob/${branchName}'), 'Should use github.com/blob/ URL format');
  assert(content.includes('?raw=true'), 'Should include ?raw=true suffix');
  assert(!content.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com');
});

test('agent.prompts.lib.mjs: uses github.com/blob/?raw=true URL format', () => {
  const agentPromptsPath = join(__dirname, '../src/agent.prompts.lib.mjs');
  const content = readFileSync(agentPromptsPath, 'utf-8');
  assert(content.includes('github.com/${owner}/${repo}/blob/${branchName}'), 'Should use github.com/blob/ URL format');
  assert(content.includes('?raw=true'), 'Should include ?raw=true suffix');
  assert(!content.includes('raw.githubusercontent.com'), 'Should NOT use raw.githubusercontent.com');
});

test('claude.prompts.lib.mjs: does NOT have repoIsPrivate parameter (simplified approach)', () => {
  const claudePromptsPath = join(__dirname, '../src/claude.prompts.lib.mjs');
  const content = readFileSync(claudePromptsPath, 'utf-8');
  assert(!content.includes('repoIsPrivate'), 'Should NOT have repoIsPrivate parameter (no longer needed)');
});

test('agent.prompts.lib.mjs: does NOT have repoIsPrivate parameter (simplified approach)', () => {
  const agentPromptsPath = join(__dirname, '../src/agent.prompts.lib.mjs');
  const content = readFileSync(agentPromptsPath, 'utf-8');
  assert(!content.includes('repoIsPrivate'), 'Should NOT have repoIsPrivate parameter (no longer needed)');
});

test('claude.lib.mjs: does NOT import or use getRepoVisibility (simplified approach)', () => {
  const claudeLibPath = join(__dirname, '../src/claude.lib.mjs');
  const content = readFileSync(claudeLibPath, 'utf-8');
  assert(!content.includes('getRepoVisibility'), 'claude.lib.mjs should NOT import getRepoVisibility (no longer needed)');
  assert(!content.includes('repoIsPrivate'), 'claude.lib.mjs should NOT use repoIsPrivate');
});

test('agent.lib.mjs: does NOT import or use getRepoVisibility (simplified approach)', () => {
  const agentLibPath = join(__dirname, '../src/agent.lib.mjs');
  const content = readFileSync(agentLibPath, 'utf-8');
  assert(!content.includes('getRepoVisibility'), 'agent.lib.mjs should NOT import getRepoVisibility (no longer needed)');
  assert(!content.includes('repoIsPrivate'), 'agent.lib.mjs should NOT use repoIsPrivate');
});

// ===== Summary =====
console.log('\n================================================================================');
console.log(`Test Summary: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);
console.log('================================================================================\n');

if (failed > 0) {
  console.log(`${RED}❌ Tests FAILED${RESET}\n`);
  process.exit(1);
} else {
  console.log(`${GREEN}✅ All tests PASSED${RESET}\n`);
  process.exit(0);
}
