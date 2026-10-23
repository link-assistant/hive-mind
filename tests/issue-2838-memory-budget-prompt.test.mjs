/**
 * @hive-mind-test-suite default
 * Issue #2838: the container memory budget guidance from #2745 reached only Codex. Claude ran
 * `free -g` (host: 7 GB available), retried `cargo test -j 2` next to a subagent and was OOM-killed.
 * Every tool's system prompt names the cgroup limit when there is one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMemoryBudgetPrompt, getMemoryBudgetSubPrompt } from '../src/memory-budget-prompt.lib.mjs';
import { buildCodexMemoryBudgetPrompt } from '../src/codex.process-exit.lib.mjs';

const LIMITED = { version: 2, path: '/sys/fs/cgroup', limitBytes: 3_135_373_312, currentBytes: 635_551_744 };

test('the shared guidance names the limit, the host-view trap and sequential builds', () => {
  const prompt = buildMemoryBudgetPrompt(LIMITED);
  assert.match(prompt, /container memory limit is 2\.92 GiB/);
  assert.match(prompt, /headroom is 2\.33 GiB/);
  assert.match(prompt, /free, top and \/proc\/meminfo show the host/);
  assert.match(prompt, /cargo -j 1/);
  assert.match(prompt, /at the same time as subagents/);
  assert.equal(buildCodexMemoryBudgetPrompt, buildMemoryBudgetPrompt, 'Codex keeps its export name');
  assert.equal(getMemoryBudgetSubPrompt({ cgroupMemory: { limitBytes: null } }), '', 'no limit, no section');
  assert.equal(
    getMemoryBudgetSubPrompt({}, () => {
      throw new Error('unreadable');
    }),
    ''
  );
  assert.match(
    getMemoryBudgetSubPrompt({}, () => LIMITED),
    /^\n\nExecution resource budget\.\n {3}- The container memory limit is 2\.92 GiB/
  );
});

const baseParams = { owner: 'o', repo: 'r', issueNumber: 1, issueUrl: 'https://github.com/o/r/issues/1', prNumber: 2, prUrl: 'https://github.com/o/r/pull/2', branchName: 'issue-1', tempDir: '/tmp/x', workspaceTmpDir: '/tmp/x-ws', isContinueMode: false, argv: {} };

for (const tool of ['claude', 'agent', 'gemini', 'opencode', 'qwen']) {
  test(`${tool}: the system prompt carries the container memory budget`, async () => {
    const { buildSystemPrompt } = await import(`../src/${tool}.prompts.lib.mjs`);
    assert.match(buildSystemPrompt({ ...baseParams, cgroupMemory: LIMITED }), /Execution resource budget\.\n {3}- The container memory limit is 2\.92 GiB/);
    assert.doesNotMatch(buildSystemPrompt({ ...baseParams, cgroupMemory: null }), /Execution resource budget/);
  });
}
