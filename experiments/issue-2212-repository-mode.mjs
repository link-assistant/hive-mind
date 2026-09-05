#!/usr/bin/env node
/**
 * Experiment for issue #2212: exercise `/solve <repository-url>` repository mode
 * end to end with a fake `gh` runner, so the combined issue body, the sub-issue
 * attachment calls and the argv overrides can be inspected without touching
 * GitHub.
 *
 * Usage: node experiments/issue-2212-repository-mode.mjs
 */

import { resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';

const openIssues = [
  { number: 5, id: 105, title: 'Oldest bug', html_url: 'https://github.com/o/r/issues/5', created_at: '2024-01-01T00:00:00Z' },
  { number: 6, id: 106, title: 'A pull request', html_url: 'https://github.com/o/r/pull/6', created_at: '2024-01-02T00:00:00Z', pull_request: { url: 'x' } },
  { number: 7, id: 107, title: 'Newer feature', html_url: 'https://github.com/o/r/issues/7', created_at: '2024-02-01T00:00:00Z' },
];

const calls = [];
const fakeRun = async (command, args) => {
  calls.push([command, ...args]);
  if (args[0] === 'api' && String(args[1]).includes('/issues?')) {
    return { code: 0, stdout: JSON.stringify(openIssues), stderr: '' };
  }
  if (args.includes('create')) {
    return { code: 0, stdout: 'https://github.com/o/r/issues/42\n', stderr: '' };
  }
  return { code: 0, stdout: '{}', stderr: '' };
};

const result = await resolveRepositoryModeTarget({
  url: 'https://github.com/o/r',
  run: fakeRun,
  log: async message => console.log(message),
});

console.log('\n--- result ---');
console.log('issueUrl:', result.issueUrl);
console.log('argvOverrides:', JSON.stringify(result.argvOverrides));
console.log(
  'attached:',
  result.issue.attached.map(i => i.number)
);

console.log('\n--- combined issue body ---');
console.log(result.prepared.body);

console.log('\n--- gh calls ---');
for (const call of calls) console.log(call.join(' '));

const nonPullRequest = result.prepared.selected.every(issue => issue.number !== 6);
if (!nonPullRequest) throw new Error('pull request leaked into the sub-issue selection');
console.log('\n✅ experiment finished');
