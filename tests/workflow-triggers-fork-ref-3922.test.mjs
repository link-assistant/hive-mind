#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3922: --auto-restart-until-mergeable on a fork pull request (konard → G-Ivan-A) read
 * `.github/workflows` of the upstream repository at `?ref=<fork branch>`. That branch does not
 * exist upstream, so the contents API answered 404 ("No commit found for the ref …"), the error
 * was swallowed, and the log said "workflows have PR/push triggers ()" — an empty list that
 * looked like a bug. The head SHA of the pull request does resolve in the upstream repository.
 *
 * A fake `gh` on PATH answers like GitHub did for G-Ivan-A/mango_ba_prompts on 2026-10-31.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const sha = 'f8f242ab489c5432fef07eaf9204ca771c1f6cba';
const fakeDir = mkdtempSync(join(tmpdir(), 'fake-gh-3922-'));
const workflow = Buffer.from('name: Validate\non:\n  pull_request:\n    branches: [main]\n').toString('base64');
writeFileSync(
  join(fakeDir, 'gh'),
  `#!/bin/sh
case "$2" in
  *"?ref=${sha}")
    case "$2" in
      *contents/.github/workflows\\?*) echo '[{"name":"validate.yml","path":".github/workflows/validate.yml"}]' ;;
      *) echo '"${workflow}"' ;;
    esac ;;
  *) echo "gh: No commit found for the ref issue-413-e424ca2a7c62 (HTTP 404)" >&2; exit 1 ;;
esac
`
);
chmodSync(join(fakeDir, 'gh'), 0o755);
process.env.PATH = `${fakeDir}:${process.env.PATH}`;
process.env.HIVE_MIND_GITHUB_RETRY_DELAY_MS = '1';
after(() => rmSync(fakeDir, { recursive: true, force: true }));

const { checkWorkflowsHavePRTriggers, describeWorkflowTriggers } = await import('../src/github-merge-ci-signals.lib.mjs');

test('the PR head SHA finds the workflow files of a fork pull request', async () => {
  const result = await checkWorkflowsHavePRTriggers('G-Ivan-A', 'mango_ba_prompts', false, sha);
  assert.deepEqual(result, { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [{ name: 'validate.yml', triggers: ['pull_request'] }] });
  assert.equal(describeWorkflowTriggers(result), 'validate.yml');
});

test('a failed lookup is reported with its reason instead of an empty "()" list', async () => {
  const result = await checkWorkflowsHavePRTriggers('G-Ivan-A', 'mango_ba_prompts', false, 'issue-413-e424ca2a7c62');
  assert.equal(result.hasPRTriggers, true, 'the safe assumption is kept');
  assert.equal(result.lookupFailed, true);
  assert.equal(result.lookupError, 'No commit found for the ref issue-413-e424ca2a7c62 (HTTP 404)');
  assert.equal(describeWorkflowTriggers(result), 'workflow files could not be read at issue-413-e424ca2a7c62: No commit found for the ref issue-413-e424ca2a7c62 (HTTP 404); assuming they do');
  assert.equal(describeWorkflowTriggers({ ...result, ref: sha }).includes(`at ${sha.slice(0, 7)}:`), true);
  assert.equal(describeWorkflowTriggers({ workflows: [] }), 'none listed');
});

test('getMergeBlockers reads workflow files at the head SHA, not at the fork branch name', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'solve.auto-merge-helpers.lib.mjs'), 'utf8');
  assert.equal(source.match(/checkWorkflowsHavePRTriggers\(owner, repo, verbose, ciStatus\.sha \|\| prBranchRef\)/g)?.length, 2);
  assert.doesNotMatch(source, /PR\/push triggers \(\$\{prTriggers\.workflows\.map/);
});
