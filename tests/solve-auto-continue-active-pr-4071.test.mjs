#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/4071
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

const issueNumber = 1580;
const activeBranch = 'issue-1580-ffffffffffff';
const otherActiveBranch = 'issue-1580-eeeeeeeeeeee';
const leftoverBranch = 'issue-1580-aaaaaaaaaaaa';
const owner = 'test-owner';
const repo = 'test-repo';
const activePr = { number: 1581, headRefName: activeBranch, state: 'OPEN', isDraft: true, createdAt: new Date().toISOString() };

process.env.HIVE_MIND_AUTO_CONTINUE_AGE_HOURS = '24';

let runGh;
function fakeDollar(strings, ...values) {
  return Array.isArray(strings) ? runGh(String.raw({ raw: strings }, ...values)) : fakeDollar;
}

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: fakeDollar };
  return import(packageName);
};

const { processAutoContinueForIssue } = await import('../src/solve.auto-continue.lib.mjs');

async function resolveIssue({ branches, prs, markers }) {
  const branchLookups = [];
  const unexpectedCommands = [];
  const json = data => ({ code: 0, stdout: JSON.stringify(data), stderr: '' });
  runGh = command => {
    if (command.startsWith(`gh api --paginate repos/${owner}/${repo}/branches `)) {
      return { code: 0, stdout: branches.join('\n'), stderr: '' };
    }
    if (command.includes(`linked:issue-${issueNumber}`)) return json([]);
    if (command.includes(`head:issue-${issueNumber}-`)) return json(prs);
    const markerProbe = command.match(/\/contents\/(CLAUDE\.md|\.gitkeep)\?ref=(.+)$/);
    if (markerProbe) {
      const [, marker, branch] = markerProbe;
      return { code: markers[branch] === marker ? 0 : 1, stdout: '', stderr: '' };
    }
    const branchLookup = command.match(/ --head (\S+) --state all /);
    if (branchLookup) {
      const [, branch] = branchLookup;
      branchLookups.push(branch);
      return json(prs.filter(pr => pr.headRefName === branch).map(({ number, state }) => ({ number, state })));
    }
    unexpectedCommands.push(command);
    return { code: 1, stdout: '', stderr: '' };
  };

  const result = await processAutoContinueForIssue({ autoContinue: true, fork: false, verbose: false }, true, issueNumber, owner, repo);
  assert.deepEqual(unexpectedCommands, []);
  return { result, branchLookups };
}

test('a young placeholder PR cannot be resumed through its branch', { timeout: 5000 }, async () => {
  const { result, branchLookups } = await resolveIssue({ branches: [activeBranch], prs: [activePr], markers: { [activeBranch]: '.gitkeep' } });

  assert.deepEqual(result, { isContinueMode: false, issueNumber });
  assert.deepEqual(branchLookups, []);
});

test('the fallback reuses a leftover branch after excluding every active PR head', { timeout: 5000 }, async () => {
  const { result, branchLookups } = await resolveIssue({
    branches: [otherActiveBranch, activeBranch, leftoverBranch],
    prs: [activePr, { ...activePr, number: 1582, headRefName: otherActiveBranch }],
    markers: { [activeBranch]: '.gitkeep', [otherActiveBranch]: 'CLAUDE.md' },
  });

  assert.deepEqual(result, { isContinueMode: true, prNumber: null, prBranch: leftoverBranch, issueNumber });
  assert.deepEqual(branchLookups, [leftoverBranch]);
});

test('the PR search can still resume an older placeholder PR', { timeout: 5000 }, async () => {
  const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { result, branchLookups } = await resolveIssue({ branches: [activeBranch], prs: [{ ...activePr, createdAt }], markers: { [activeBranch]: 'CLAUDE.md' } });

  assert.deepEqual(result, { isContinueMode: true, prNumber: activePr.number, prBranch: activeBranch, issueNumber });
  assert.deepEqual(branchLookups, []);
});

test('the PR search can still resume a young PR after its placeholders are removed', { timeout: 5000 }, async () => {
  const { result, branchLookups } = await resolveIssue({ branches: [activeBranch], prs: [activePr], markers: {} });

  assert.deepEqual(result, { isContinueMode: true, prNumber: activePr.number, prBranch: activeBranch, issueNumber });
  assert.deepEqual(branchLookups, []);
});
