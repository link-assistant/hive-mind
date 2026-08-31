#!/usr/bin/env node

/**
 * Unit Tests: Issue #1887 - Increase probability the AI fixes all CI/CD in the PR
 *
 * When --auto-restart-until-mergeable is enabled and a PR's CI/CD stays red, the
 * session restarts forever. The AI must be nudged to actually fix failing checks —
 * even when the breakage looks pre-existing or inherited from another branch —
 * instead of only reporting it and asking for a human decision, which loops.
 *
 * These tests verify the new guidance is present in:
 *   1. buildAutoRestartInstructions() (the auto-restart feedback prompt), and
 *   2. buildSystemPrompt() for every supported AI tool.
 *
 * Run with: node tests/test-issue-1887-ci-fix-prompt.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1887
 */

import { buildAutoRestartInstructions } from '../src/solve.restart-shared.lib.mjs';

import { buildSystemPrompt as claudeSystemPrompt } from '../src/claude.prompts.lib.mjs';
import { buildSystemPrompt as codexSystemPrompt } from '../src/codex.prompts.lib.mjs';
import { buildSystemPrompt as geminiSystemPrompt } from '../src/gemini.prompts.lib.mjs';
import { buildSystemPrompt as qwenSystemPrompt } from '../src/qwen.prompts.lib.mjs';
import { buildSystemPrompt as agentSystemPrompt } from '../src/agent.prompts.lib.mjs';
import { buildSystemPrompt as opencodeSystemPrompt } from '../src/opencode.prompts.lib.mjs';

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
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
console.log('Unit Tests: Issue #1887 - Fix-all-CI/CD prompt guidance');
console.log('================================================================================\n');

// ===== Test Group 1: Auto-restart instructions =====
console.log('📋 buildAutoRestartInstructions() guidance\n');

const restart = buildAutoRestartInstructions().join('\n');

test('Auto-restart prompt tells the AI to fix failing checks even when pre-existing', () => {
  assert(/pre-existing/i.test(restart), 'Should mention pre-existing failures');
  assert(/inherited from another branch/i.test(restart), 'Should mention inherited-from-another-branch failures');
  assert(/fix it so all checks pass/i.test(restart), 'Should instruct to fix so checks pass');
});

test('Auto-restart prompt warns about the infinite restart loop', () => {
  assert(/auto-restarts until the pull request is mergeable/i.test(restart), 'Should explain the auto-restart loop');
  assert(/loop indefinitely/i.test(restart), 'Should warn leaving a check unaddressed loops indefinitely');
});

test('Auto-restart prompt frames repository-wide breakage as in scope unless restricted', () => {
  assert(/repository-wide breakage as in scope/i.test(restart), 'Should treat repo-wide breakage as in scope');
  assert(/scope is explicitly restricted/i.test(restart), 'Should respect explicitly restricted scope');
});

test('Auto-restart prompt still permits asking for human help after attempting a fix', () => {
  assert(/human decision/i.test(restart) || /attempt your best fix first/i.test(restart), 'Should allow human escalation after attempting a fix');
});

// ===== Test Group 2: System prompts across all tools =====
console.log('\n📋 buildSystemPrompt() guidance across all AI tools\n');

const baseParams = {
  owner: 'link-assistant',
  repo: 'hive-mind',
  issueNumber: 1887,
  prNumber: 1888,
  branchName: 'issue-1887-test',
  argv: {},
  modelSupportsVision: false,
};

const builders = {
  claude: claudeSystemPrompt,
  codex: codexSystemPrompt,
  gemini: geminiSystemPrompt,
  qwen: qwenSystemPrompt,
  agent: agentSystemPrompt,
  opencode: opencodeSystemPrompt,
};

for (const [tool, build] of Object.entries(builders)) {
  const prompt = build(baseParams);

  test(`${tool}: system prompt instructs fixing failing CI/CD even if pre-existing`, () => {
    assert(/When CI or CD checks are failing on the pull request/.test(prompt), `${tool} should contain the CI/CD fix guidance`);
    assert(/pre-existing, inherited from another branch/.test(prompt), `${tool} should mention pre-existing/inherited failures`);
    assert(/Do not assume a failing check is out of scope/.test(prompt), `${tool} should say a failing check is not automatically out of scope`);
  });

  test(`${tool}: system prompt sets repository-wide fix scope and clean default branch`, () => {
    assert(/keep the default branch in a clean and working state/.test(prompt), `${tool} should mention keeping the default branch clean`);
    assert(/assume the scope of all fixes is the entire repository/.test(prompt), `${tool} should assume repository-wide scope`);
    assert(/Unless the user explicitly restricts the scope/.test(prompt), `${tool} should respect explicit scope restriction`);
  });
}

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1887:`);
console.log(`  ${GREEN}✅ Passed:${RESET} ${passed}`);
console.log(`  ${RED}❌ Failed:${RESET} ${failed}`);
console.log(`  Total: ${passed + failed}`);
console.log('================================================================================\n');

if (failed > 0) {
  console.log(`${RED}❌ Some tests failed!${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}✅ All tests passed!${RESET}`);
  process.exit(0);
}
