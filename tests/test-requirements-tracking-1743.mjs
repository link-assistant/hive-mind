#!/usr/bin/env node

/**
 * Regression coverage for issue #1743.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsModule from 'node:fs';
import osModule from 'node:os';
import pathModule from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.use = async name => {
  if (name === 'command-stream') {
    return {
      $: () => ({
        code: 0,
        stdout: '',
        stderr: '',
        stream: async function* stream() {},
      }),
    };
  }
  if (name === 'fs') return { ...fsModule, default: fsModule };
  if (name === 'path') return { ...pathModule, default: pathModule };
  if (name === 'os') return { ...osModule, default: osModule };
  return await import(name);
};

const __dirname = pathModule.dirname(fileURLToPath(import.meta.url));
const repoRoot = pathModule.join(__dirname, '..');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const buildPromptParams = argv => ({
  owner: 'link-assistant',
  repo: 'hive-mind',
  issueNumber: 1743,
  prNumber: 1744,
  branchName: 'issue-1743-df64c32eba77',
  workspaceTmpDir: '/tmp/hive-mind',
  argv,
  modelSupportsVision: false,
});

test('requirements-tracking option is defined and disabled by default', async () => {
  const { SOLVE_OPTION_DEFINITIONS } = await import('../src/solve.config.lib.mjs');
  const option = SOLVE_OPTION_DEFINITIONS['requirements-tracking'];

  assert.ok(option, 'requirements-tracking option should exist');
  assert.equal(option.type, 'boolean');
  assert.equal(option.default, false);
  assert.match(option.description, /docs\/requirements\/\*\.md/);
});

test('requirements-tracking prompt is gated and mentions the requirements ledger', async () => {
  const { getRequirementsTrackingSubPrompt } = await import('../src/requirements-tracking.prompts.lib.mjs');

  assert.equal(getRequirementsTrackingSubPrompt({ requirementsTracking: false }), '');

  const prompt = getRequirementsTrackingSubPrompt({ requirementsTracking: true });
  assert.match(prompt, /Requirements Tracking/);
  assert.match(prompt, /docs\/requirements\/README\.md/);
  assert.match(prompt, /docs\/requirements\/\*\.md/);
});

test('all supported tool prompts include requirements tracking only when enabled', async () => {
  const promptModules = ['claude', 'codex', 'gemini', 'qwen', 'opencode', 'agent'];

  for (const tool of promptModules) {
    const { buildSystemPrompt } = await import(`../src/${tool}.prompts.lib.mjs`);

    const disabledPrompt = buildSystemPrompt(buildPromptParams({ requirementsTracking: false }));
    assert.equal(disabledPrompt.includes('Requirements Tracking.'), false, `${tool} prompt should omit requirements tracking by default`);

    const enabledPrompt = buildSystemPrompt(buildPromptParams({ requirementsTracking: true }));
    assert.equal(enabledPrompt.includes('Requirements Tracking.'), true, `${tool} prompt should include requirements tracking when enabled`);
    assert.equal(enabledPrompt.includes('docs/requirements/README.md'), true, `${tool} prompt should mention docs/requirements/README.md`);
  }
});

test('PR changed-file helpers detect docs/requirements markdown updates', async () => {
  const { buildRequirementsDocsNotUpdatedHint, hasRequirementsTrackingDocumentChange, isRequirementsTrackingDocumentPath } = await import('../src/solve.results.lib.mjs');

  assert.equal(isRequirementsTrackingDocumentPath('docs/requirements/README.md'), true);
  assert.equal(isRequirementsTrackingDocumentPath('docs/requirements/product.md'), true);
  assert.equal(isRequirementsTrackingDocumentPath('docs/requirements/product.txt'), false);
  assert.equal(isRequirementsTrackingDocumentPath('docs/case-studies/issue-1743/README.md'), false);
  assert.equal(hasRequirementsTrackingDocumentChange(['src/solve.mjs', 'docs/requirements/README.md']), true);
  assert.equal(hasRequirementsTrackingDocumentChange(['src/solve.mjs', 'docs/CONFIGURATION.md']), false);
  assert.ok(buildRequirementsDocsNotUpdatedHint().some(line => line.includes('docs/requirements/*.md')));
});

test('solve.mjs has a requirements tracking auto-restart hook before finalize', async () => {
  const source = await fs.readFile(pathModule.join(repoRoot, 'src', 'solve.mjs'), 'utf8');
  const verifyResultPos = source.indexOf('let verifyResult = await verifyResults(');
  const requirementsRestartPos = source.indexOf('AUTO-RESTART: Requirements tracking docs not updated');
  const finalizePos = source.indexOf('const autoEnsureResult = await runAutoEnsureRequirements(');

  assert.ok(verifyResultPos > 0, 'verifyResult should be mutable so restart checks can use refreshed verification data');
  assert.ok(requirementsRestartPos > verifyResultPos, 'requirements tracking restart should run after verifyResults');
  assert.ok(requirementsRestartPos < finalizePos, 'requirements tracking restart should run before --finalize');
});

let passed = 0;

for (const { name, fn } of tests) {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

console.log(`\n${passed} issue #1743 requirements tracking tests passed`);
