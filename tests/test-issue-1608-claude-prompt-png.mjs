#!/usr/bin/env node

/**
 * Regression test: Issue #1608 - Claude system prompt crashes on `.png` text
 *
 * The Claude prompt builder should return a string even when:
 * - vision instructions are enabled
 * - case-study prompt instructions are enabled
 * - image download guidance mentions `.png`
 *
 * Run with: node tests/test-issue-1608-claude-prompt-png.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1608
 */

import assert from 'node:assert/strict';
import { test, printSummary, getFailCount } from './test-helpers.mjs';
import { buildSystemPrompt } from '../src/claude.prompts.lib.mjs';

const params = {
  owner: 'link-assistant',
  repo: 'hive-mind',
  issueNumber: 1608,
  prNumber: 1609,
  branchName: 'issue-1608-93b943606ff3',
  workspaceTmpDir: null,
  modelSupportsVision: true,
  forkedRepo: null,
  argv: {
    promptCaseStudies: true,
  },
};

test('buildSystemPrompt returns a string with screenshot and case-study guidance enabled', () => {
  const prompt = buildSystemPrompt(params);

  assert.equal(typeof prompt, 'string');
  assert.ok(prompt.includes('Visual UI work and screenshots'));
  assert.ok(prompt.includes('saved as `.png`'));
  assert.ok(prompt.includes('./docs/case-studies/issue-1608/'));
});

printSummary(80);

if (getFailCount() > 0) {
  process.exit(1);
}
