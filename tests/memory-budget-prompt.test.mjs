/** @hive-mind-test-suite default */
// Issue #3125: a /claude session in a 2.92 GiB container ran
// cmake --build --parallel (an unlimited make -j) and the kernel OOM killer
// ended the session. Only Codex was told about the memory limit (#2838); every
// tool now gets the same memory budget guidance.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getMemoryBudgetSubPrompt, suggestBuildJobs } from '../src/memory-budget.prompts.lib.mjs';
import * as agentPrompts from '../src/agent.prompts.lib.mjs';
import * as claudePrompts from '../src/claude.prompts.lib.mjs';
import * as codexPrompts from '../src/codex.prompts.lib.mjs';
import * as geminiPrompts from '../src/gemini.prompts.lib.mjs';
import * as opencodePrompts from '../src/opencode.prompts.lib.mjs';
import * as qwenPrompts from '../src/qwen.prompts.lib.mjs';

const GIB = 1024 ** 3;
// memory.max of the container in the incident (links-notation#340).
const INCIDENT_LIMIT = 3135369216;

test('suggested job count fits the memory limit and the CPU count', () => {
  assert.equal(suggestBuildJobs(INCIDENT_LIMIT, 6), 2, 'the incident container fits two compiler jobs');
  assert.equal(suggestBuildJobs(GIB, 8), 1, 'at least one job even when the limit is tiny');
  assert.equal(suggestBuildJobs(64 * GIB, 4), 4, 'never more than the CPUs');
  for (const limit of [null, undefined, Infinity, 0, -1]) assert.equal(suggestBuildJobs(limit, 3), 3, `no limit (${limit}) falls back to the CPUs`);
  assert.equal(suggestBuildJobs(INCIDENT_LIMIT, 0), 1, 'an unknown CPU count still allows one job');
});

test('guidance names the limit, an explicit job count and the unlimited forms', () => {
  const prompt = getMemoryBudgetSubPrompt({ snapshot: { limitBytes: INCIDENT_LIMIT, currentBytes: 123 }, cpuCount: 6 });
  assert.match(prompt, /memory limit of 2\.92 GiB/);
  assert.match(prompt, /at most 2 here/);
  assert.match(prompt, /make -j2, cmake --build build --parallel 2, ninja -j2, ctest -j2 or cargo build -j 2/);
  assert.match(prompt, /bare make -j or cmake --build --parallel without a number starts unlimited jobs/);
  assert.match(prompt, /\/sys\/fs\/cgroup\/memory\.max/);
  assert.match(prompt, /exit code 137/);
  assert.doesNotMatch(prompt, /0\.00|123/, 'current use is left out so the prompt stays stable');
  for (const line of prompt.split('\n')) assert.match(line, /^ {3}- /, 'every line is a General guidelines bullet');
});

test('guidance without a known limit still asks for an explicit job count', () => {
  for (const snapshot of [null, {}, { limitBytes: null }, { limitBytes: Infinity }]) {
    const prompt = getMemoryBudgetSubPrompt({ snapshot, cpuCount: 6 });
    assert.doesNotMatch(prompt, /GiB|NaN|undefined/);
    assert.match(prompt, /explicit, small job count/);
    assert.match(prompt, /without a number starts unlimited jobs/);
  }
});

test('guidance is safe inside a double-quoted shell argument', () => {
  for (const snapshot of [null, { limitBytes: INCIDENT_LIMIT }]) assert.doesNotMatch(getMemoryBudgetSubPrompt({ snapshot, cpuCount: 6 }), /[$`"]/);
});

test('every tool system prompt includes the memory budget guidance', () => {
  const params = { owner: 'konard', repo: 'test-hello-world', issueNumber: 1, prNumber: 2, branchName: 'issue-1-example', workspaceTmpDir: null, argv: {}, modelSupportsVision: false, forkedRepo: null };
  const expected = getMemoryBudgetSubPrompt();
  for (const [tool, prompts] of Object.entries({ agent: agentPrompts, claude: claudePrompts, codex: codexPrompts, gemini: geminiPrompts, opencode: opencodePrompts, qwen: qwenPrompts })) {
    const systemPrompt = prompts.buildSystemPrompt(params);
    assert.ok(systemPrompt.includes(expected), `${tool} system prompt includes the memory budget guidance`);
    assert.ok(systemPrompt.indexOf(expected) < systemPrompt.indexOf('Initial research.'), `${tool} lists it under General guidelines`);
  }
});
