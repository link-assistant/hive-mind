#!/usr/bin/env node

/**
 * Unit Tests: Issue #1349 - Broken image links in PR descriptions for private repositories
 *
 * Tests verify that:
 * 1. Public repo + vision model → screenshot instructions include raw.githubusercontent.com URL pattern
 * 2. Private repo + vision model → screenshot instructions contain warning about broken raw URLs
 * 3. Private repo + vision model → screenshot instructions do NOT include raw.githubusercontent.com for embedding
 * 4. No vision model → no screenshot section in either case
 * 5. repoIsPrivate defaults to false (backward compat) when not provided
 * 6. Same behavior in both claude.prompts.lib.mjs and agent.prompts.lib.mjs
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

test('Public repo + vision model → screenshot section includes raw.githubusercontent.com URL', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: false,
  });

  assert(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
  assert(
    prompt.includes('raw.githubusercontent.com/test-owner/test-repo/test-branch'),
    'Should include raw.githubusercontent.com URL with correct owner/repo/branch',
  );
  assert(!prompt.includes('PRIVATE repository'), 'Should NOT include private repo warning');
  assert(!prompt.includes('HTTP 404'), 'Should NOT include HTTP 404 warning');
});

test('Private repo + vision model → screenshot section contains private repo warning', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: true,
  });

  assert(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
  assert(prompt.includes('PRIVATE repository'), 'Should include PRIVATE repository warning');
  assert(prompt.includes('HTTP 404'), 'Should include HTTP 404 warning explaining broken URLs');
});

test('Private repo + vision model → screenshot section does NOT include raw URL for embedding', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: true,
  });

  // The raw.githubusercontent.com URL should NOT appear as an embedding instruction
  // (It may appear in text explaining why not to use it, but not as a positive instruction)
  assert(
    !prompt.includes('use permanent raw file links in the pull request description'),
    'Should NOT instruct to use permanent raw file links',
  );
  assert(!prompt.includes('commit them to the branch first, then reference them using the raw GitHub URL format'), 'Should NOT instruct to use raw GitHub URL format for embedding');
});

test('Private repo + vision model → instructs to describe visual results in text', () => {
  const prompt = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: true,
  });

  assert(prompt.includes('describe what the screenshot shows in text form'), 'Should instruct to describe screenshots in text form');
});

test('No vision model → no screenshot section (regardless of repo visibility)', () => {
  const promptPublic = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
    repoIsPrivate: false,
  });

  const promptPrivate = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
    repoIsPrivate: true,
  });

  assert(!promptPublic.includes('Visual UI work and screenshots'), 'Public repo without vision: no screenshot section');
  assert(!promptPrivate.includes('Visual UI work and screenshots'), 'Private repo without vision: no screenshot section');
});

test('repoIsPrivate defaults to false (public behavior) when not provided', () => {
  const promptWithDefault = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    // repoIsPrivate not provided → defaults to false
  });

  const promptPublic = claudeBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: false,
  });

  assert(
    promptWithDefault.includes('raw.githubusercontent.com/test-owner/test-repo/test-branch'),
    'Default (no repoIsPrivate) should behave like public repo',
  );
  assert(!promptWithDefault.includes('PRIVATE repository'), 'Default should NOT include private repo warning');
  assert(promptWithDefault === promptPublic, 'Default behavior should match explicit repoIsPrivate=false');
});

// ===== Tests for agent.prompts.lib.mjs =====
console.log(`\n${BLUE}📋 Tests for agent.prompts.lib.mjs${RESET}\n`);

test('[agent] Public repo + vision model → screenshot section includes raw.githubusercontent.com URL', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: false,
  });

  assert(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
  assert(
    prompt.includes('raw.githubusercontent.com/test-owner/test-repo/test-branch'),
    'Should include raw.githubusercontent.com URL with correct owner/repo/branch',
  );
  assert(!prompt.includes('PRIVATE repository'), 'Should NOT include private repo warning');
});

test('[agent] Private repo + vision model → screenshot section contains private repo warning', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: true,
  });

  assert(prompt.includes('Visual UI work and screenshots'), 'Should include screenshot section header');
  assert(prompt.includes('PRIVATE repository'), 'Should include PRIVATE repository warning');
  assert(prompt.includes('HTTP 404'), 'Should include HTTP 404 warning explaining broken URLs');
});

test('[agent] Private repo + vision model → does NOT include raw URL embedding instruction', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: true,
  });

  assert(!prompt.includes('use permanent raw file links in the pull request description'), 'Should NOT instruct to use permanent raw file links');
  assert(!prompt.includes('commit them to the branch first, then reference them using the raw GitHub URL format'), 'Should NOT instruct to use raw GitHub URL format for embedding');
});

test('[agent] Private repo + vision model → instructs to describe visual results in text', () => {
  const prompt = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    repoIsPrivate: true,
  });

  assert(prompt.includes('describe what the screenshot shows in text form'), 'Should instruct to describe screenshots in text form');
});

test('[agent] No vision model → no screenshot section (regardless of repo visibility)', () => {
  const promptPublic = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
    repoIsPrivate: false,
  });

  const promptPrivate = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: false,
    repoIsPrivate: true,
  });

  assert(!promptPublic.includes('Visual UI work and screenshots'), 'Public repo without vision: no screenshot section');
  assert(!promptPrivate.includes('Visual UI work and screenshots'), 'Private repo without vision: no screenshot section');
});

test('[agent] repoIsPrivate defaults to false (public behavior) when not provided', () => {
  const promptWithDefault = agentBuildSystemPrompt({
    ...baseParams,
    modelSupportsVision: true,
    // repoIsPrivate not provided → defaults to false
  });

  assert(
    promptWithDefault.includes('raw.githubusercontent.com/test-owner/test-repo/test-branch'),
    'Default (no repoIsPrivate) should behave like public repo',
  );
  assert(!promptWithDefault.includes('PRIVATE repository'), 'Default should NOT include private repo warning');
});

// ===== Source code verification tests =====
console.log(`\n${BLUE}📋 Source code verification tests${RESET}\n`);

test('claude.prompts.lib.mjs: buildSystemPrompt accepts repoIsPrivate parameter', () => {
  const claudePromptsPath = join(__dirname, '../src/claude.prompts.lib.mjs');
  const content = readFileSync(claudePromptsPath, 'utf-8');
  assert(content.includes('repoIsPrivate = false'), 'claude.prompts.lib.mjs should destructure repoIsPrivate with default false');
});

test('agent.prompts.lib.mjs: buildSystemPrompt accepts repoIsPrivate parameter', () => {
  const agentPromptsPath = join(__dirname, '../src/agent.prompts.lib.mjs');
  const content = readFileSync(agentPromptsPath, 'utf-8');
  assert(content.includes('repoIsPrivate = false'), 'agent.prompts.lib.mjs should destructure repoIsPrivate with default false');
});

test('claude.lib.mjs: imports getRepoVisibility from github-merge.lib.mjs', () => {
  const claudeLibPath = join(__dirname, '../src/claude.lib.mjs');
  const content = readFileSync(claudeLibPath, 'utf-8');
  assert(content.includes('getRepoVisibility'), 'claude.lib.mjs should import getRepoVisibility');
  assert(content.includes('github-merge.lib.mjs'), 'claude.lib.mjs should import from github-merge.lib.mjs');
});

test('claude.lib.mjs: passes repoIsPrivate to buildSystemPrompt', () => {
  const claudeLibPath = join(__dirname, '../src/claude.lib.mjs');
  const content = readFileSync(claudeLibPath, 'utf-8');
  assert(content.includes('repoIsPrivate,'), 'claude.lib.mjs should pass repoIsPrivate to buildSystemPrompt');
  assert(content.includes('getRepoVisibility(owner, repo'), 'claude.lib.mjs should call getRepoVisibility');
});

test('agent.lib.mjs: imports getRepoVisibility from github-merge.lib.mjs', () => {
  const agentLibPath = join(__dirname, '../src/agent.lib.mjs');
  const content = readFileSync(agentLibPath, 'utf-8');
  assert(content.includes('getRepoVisibility'), 'agent.lib.mjs should import getRepoVisibility');
  assert(content.includes('github-merge.lib.mjs'), 'agent.lib.mjs should import from github-merge.lib.mjs');
});

test('agent.lib.mjs: passes repoIsPrivate to buildSystemPrompt', () => {
  const agentLibPath = join(__dirname, '../src/agent.lib.mjs');
  const content = readFileSync(agentLibPath, 'utf-8');
  assert(content.includes('repoIsPrivate,'), 'agent.lib.mjs should pass repoIsPrivate to buildSystemPrompt');
  assert(content.includes('getRepoVisibility(owner, repo'), 'agent.lib.mjs should call getRepoVisibility');
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
