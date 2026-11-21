#!/usr/bin/env node
/**
 * Issue #3108 reproduction: `/solve <repository-url>` on a repository whose
 * only open issue is #68 (link-foundation/lino-objects-codec on 2026-10-11).
 *
 * Uses a fake `gh` so nothing is created on GitHub. Before the fix it prints a
 * combined issue (#69) with one sub-issue; after the fix it prints the issue
 * URL of #68 and no write calls.
 *
 * Usage: node experiments/issue-3108-single-issue-repro.mjs
 */
import { resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';

const url = 'https://github.com/link-foundation/lino-objects-codec';
const calls = [];
const run = async (command, args) => {
  calls.push([command, ...args].join(' '));
  if (args[0] === 'api' && String(args[1]).includes('/issues?')) {
    return { code: 0, stdout: JSON.stringify([{ id: 68000, number: 68, title: 'Readable decoder fails on valid 144MB document', html_url: `${url}/issues/68`, created_at: '2026-10-11T11:43:19Z' }]), stderr: '' };
  }
  if (args[0] === 'issue' && args[1] === 'create') return { code: 0, stdout: `${url}/issues/69\n`, stderr: '' };
  return { code: 0, stdout: '{}', stderr: '' };
};

const result = await resolveRepositoryModeTarget({ url, run, log: async message => console.log(message), attachOptions: { delayMs: 0 } });
const writes = calls.filter(call => call.includes('issue create') || call.includes('/sub_issues'));
console.log('---');
console.log(`issue to solve: ${result.issueUrl}`);
console.log(`argv overrides: ${JSON.stringify(result.argvOverrides)}`);
console.log(`GitHub write calls: ${writes.length}`);
for (const call of writes) console.log(`  gh ${call.replace(/^gh /, '')}`);
process.exit(writes.length === 0 && result.issueUrl === `${url}/issues/68` ? 0 : 1);
