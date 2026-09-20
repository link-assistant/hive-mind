#!/usr/bin/env node
/**
 * Tests for auto-continue PR detection across base branches (issue #1895).
 *
 * Root cause: `--auto-continue` detected the existing PR for an issue using
 * GitHub's `linked:issue` search. A PR that targets a NON-default base branch
 * (e.g. created with `--base-branch <not-main>`, or a stacked sub-issue branch)
 * never appears in that search, because GitHub only registers closing
 * references for PRs into the default branch. As a result auto-continue was
 * blind to such PRs and would create a duplicate instead of resuming.
 *
 * `collectIssuePrCandidates` fixes this by additionally searching for PRs whose
 * head branch matches the deterministic `issue-{N}-{hash}` name, which is
 * reliable regardless of the base branch.
 *
 * Run with: node tests/solve-auto-continue-detection-1895.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1895
 */

import assert from 'node:assert/strict';
import { collectIssuePrCandidates } from '../src/solve.auto-continue.lib.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✅ ${name}`);
      passed++;
    })
    .catch(error => {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.stack || error.message}`);
      failed++;
    });
}

/**
 * Build a fake command-stream `$` tagged-template that records every issued
 * command and answers based on which search qualifier it contains.
 *
 * @param {{linked?: Array, head?: Array, linkedCode?: number, headCode?: number}} cfg
 */
function makeFakeDollar(cfg = {}) {
  const commands = [];
  const fake = (strings, ...values) => {
    let cmd = '';
    strings.forEach((s, i) => {
      cmd += s + (i < values.length ? String(values[i]) : '');
    });
    commands.push(cmd);

    const reply = (rows, code = 0) => Promise.resolve({ code, stdout: JSON.stringify(rows ?? []) });

    if (cmd.includes('linked:issue')) {
      return reply(cfg.linked, cfg.linkedCode ?? 0);
    }
    if (cmd.includes('head:')) {
      return reply(cfg.head, cfg.headCode ?? 0);
    }
    return Promise.resolve({ code: 1, stdout: '' });
  };
  fake.commands = commands;
  return fake;
}

const nonDefaultBasePr = { number: 65, createdAt: '2025-01-01T00:00:00Z', headRefName: 'issue-49-3a3011bb1089', isDraft: true, state: 'OPEN' };
const linkedPr = { number: 70, createdAt: '2025-01-02T00:00:00Z', headRefName: 'issue-49-aaaaaaaaaaaa', isDraft: false, state: 'OPEN' };

console.log('\n📋 collectIssuePrCandidates (issue #1895)\n');

test('finds a PR that only the head-branch search returns (non-default base, #1895)', async () => {
  // The exact reproduction: GitHub omits the PR from `linked:issue` (empty),
  // but the head-branch search surfaces it.
  const $ = makeFakeDollar({ linked: [], head: [nonDefaultBasePr] });
  const prs = await collectIssuePrCandidates({ $, owner: 'link-foundation', repo: 'meta-language', issueNumber: 49 });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, 65);
});

test('issues both a linked:issue search and a head-branch prefix search', async () => {
  const $ = makeFakeDollar({ linked: [], head: [] });
  await collectIssuePrCandidates({ $, owner: 'o', repo: 'r', issueNumber: 49 });
  assert.equal($.commands.length, 2);
  assert.ok(
    $.commands.some(c => c.includes('linked:issue-49')),
    'expected a linked:issue-49 search (legacy behavior preserved)'
  );
  assert.ok(
    $.commands.some(c => c.includes('head:issue-49-')),
    'expected a head:issue-49- prefix search (the #1895 fix)'
  );
});

test('preserves legacy behavior: linked-only PR is still returned', async () => {
  const $ = makeFakeDollar({ linked: [linkedPr], head: [] });
  const prs = await collectIssuePrCandidates({ $, owner: 'o', repo: 'r', issueNumber: 49 });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, 70);
});

test('dedupes a PR returned by both sources', async () => {
  const $ = makeFakeDollar({ linked: [linkedPr], head: [linkedPr] });
  const prs = await collectIssuePrCandidates({ $, owner: 'o', repo: 'r', issueNumber: 49 });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, 70);
});

test('merges distinct PRs from both sources', async () => {
  const $ = makeFakeDollar({ linked: [linkedPr], head: [nonDefaultBasePr] });
  const prs = await collectIssuePrCandidates({ $, owner: 'o', repo: 'r', issueNumber: 49 });
  const numbers = prs.map(p => p.number).sort();
  assert.deepEqual(numbers, [65, 70]);
});

test('returns [] when both searches fail (non-zero exit)', async () => {
  const $ = makeFakeDollar({ linked: [], head: [], linkedCode: 1, headCode: 1 });
  const prs = await collectIssuePrCandidates({ $, owner: 'o', repo: 'r', issueNumber: 49 });
  assert.deepEqual(prs, []);
});

test('tolerates malformed JSON without throwing', async () => {
  const $ = (strings, ...values) => {
    let cmd = '';
    strings.forEach((s, i) => {
      cmd += s + (i < values.length ? String(values[i]) : '');
    });
    if (cmd.includes('head:')) {
      return Promise.resolve({ code: 0, stdout: 'not json' });
    }
    return Promise.resolve({ code: 0, stdout: JSON.stringify([linkedPr]) });
  };
  const prs = await collectIssuePrCandidates({ $, owner: 'o', repo: 'r', issueNumber: 49 });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, 70);
});

// Report results after all async tests settle.
process.on('beforeExit', () => {
  console.log(`\nTests passed: ${passed}`);
  console.log(`Tests failed: ${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
});
