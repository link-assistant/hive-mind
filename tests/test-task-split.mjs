#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import path from 'path';
import { buildStartAgentArgs, getBundledStartAgentCandidate, resolveStartAgentCommand } from '../src/task.agent-command.lib.mjs';
import { appendOrReplaceParentSplitSection, buildAddSubIssueApiArgs, buildIssueRestIdApiArgs, buildTaskSplitPrompt, extractTaskSplitJson, formatChildIssueBody, normalizeSplitTasks, parseTaskIssueUrl, TASK_SPLIT_MARKER_START } from '../src/task.split.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

await test('parseTaskIssueUrl accepts issues and rejects pull requests', () => {
  assert.equal(parseTaskIssueUrl('https://github.com/link-assistant/hive-mind/issues/501').valid, true);
  const pr = parseTaskIssueUrl('https://github.com/link-assistant/hive-mind/pull/553');
  assert.equal(pr.valid, false);
  assert.match(pr.error, /issues, not pull requests/);
});

await test('buildTaskSplitPrompt requires exact task count', () => {
  const prompt = buildTaskSplitPrompt({
    splitCount: 2,
    issue: {
      owner: 'link-assistant',
      repo: 'hive-mind',
      number: 501,
      url: 'https://github.com/link-assistant/hive-mind/issues/501',
      title: 'Split task',
      body: 'Body',
    },
  });
  assert.match(prompt, /exactly 2 smaller GitHub issues/);
  assert.match(prompt, /tasks array must contain exactly 2 items/);
});

await test('extractTaskSplitJson reads fenced JSON', () => {
  const parsed = extractTaskSplitJson('```json\n{"tasks":[{"title":"A","body":"Do A"},{"title":"B","body":"Do B"}]}\n```');
  assert.equal(parsed.tasks.length, 2);
});

await test('normalizeSplitTasks validates count and fields', () => {
  const tasks = normalizeSplitTasks(
    {
      tasks: [
        { title: 'First', body: 'Do first', dependencies: [] },
        { title: 'Second', body: 'Do second', dependencies: [1, 1, 99] },
      ],
    },
    2
  );
  assert.deepEqual(tasks[1].dependencies, [1]);
  assert.throws(() => normalizeSplitTasks({ tasks: [{ title: 'Only', body: 'One' }] }, 2), /Expected exactly 2/);
});

await test('formatChildIssueBody links parent issue and dependencies', () => {
  const body = formatChildIssueBody({
    parentIssue: { url: 'https://github.com/link-assistant/hive-mind/issues/501', number: 501 },
    task: { body: 'Implement part A', dependencies: [1] },
    index: 1,
    splitCount: 2,
  });
  assert.match(body, /Split from: https:\/\/github.com\/link-assistant\/hive-mind\/issues\/501/);
  assert.match(body, /Parent issue: #501/);
  assert.match(body, /Dependencies: Task 1/);
});

await test('appendOrReplaceParentSplitSection keeps one managed section', () => {
  const first = appendOrReplaceParentSplitSection('Original body', [
    { number: 10, title: 'A' },
    { number: 11, title: 'B' },
  ]);
  const second = appendOrReplaceParentSplitSection(first, [{ number: 12, title: 'C' }]);
  assert.equal((second.match(new RegExp(TASK_SPLIT_MARKER_START, 'g')) || []).length, 1);
  assert.match(second, /#12 C/);
  assert.doesNotMatch(second, /#10 A/);
});

await test('sub-issue API helpers target GitHub relationship endpoints', () => {
  const parentIssue = { owner: 'owner', repo: 'repo', number: 123 };

  assert.equal(buildIssueRestIdApiArgs({ owner: 'owner', repo: 'repo', number: 456 }).join(' '), 'api repos/owner/repo/issues/456 --jq .id');

  const args = buildAddSubIssueApiArgs({ parentIssue, subIssueId: 987 });
  assert.equal(args.includes('repos/owner/repo/issues/123/sub_issues'), true);
  assert.equal(args.includes('X-GitHub-Api-Version: 2026-03-10'), true);
  assert.equal(args.includes('sub_issue_id=987'), true);
});

await test('start-agent args enforce read-only planning mode', () => {
  const args = buildStartAgentArgs({
    tool: 'codex',
    workingDirectory: '/repo',
    prompt: 'Split issue',
    systemPrompt: 'Return JSON',
    model: 'gpt-5.5',
    isolation: 'screen',
    screenName: 'task-split-test',
    verbose: true,
  });

  assert.deepEqual(args.slice(0, 13), ['--tool', 'codex', '--working-directory', '/repo', '--prompt', 'Split issue', '--system-prompt', 'Return JSON', '--model', 'gpt-5.5', '--isolation', 'screen', '--read-only']);
  assert.equal(args.includes('--screen-name'), true);
  assert.equal(args.includes('task-split-test'), true);
  assert.equal(args.includes('--verbose'), true);
});

await test('agent-commander dependency provides start-agent before PATH lookup', async () => {
  const bundled = getBundledStartAgentCandidate();
  assert.ok(bundled, 'expected bundled agent-commander start-agent path');
  assert.equal(path.basename(bundled), 'start-agent.mjs');

  let pathLookupCalled = false;
  const resolved = await resolveStartAgentCommand({
    runCommand: async () => {
      pathLookupCalled = true;
      return { code: 1, stdout: '', stderr: '' };
    },
  });

  assert.equal(resolved, bundled);
  assert.equal(pathLookupCalled, false);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
