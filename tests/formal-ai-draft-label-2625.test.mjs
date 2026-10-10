/**
 * Regression coverage for issue #2625 (Formal AI Draft run 37606848542).
 *
 * The draft was opened as pull request #2616, then finalizing it failed:
 *
 *   Command failed: gh pr edit 2616 --add-label formal-ai-draft
 *   'formal-ai-draft' not found
 *
 * The repository never had the label, so no draft was ever labelled and the
 * batch could not be listed. The workflow now creates the label the first
 * time it is missing (it already holds `issues: write`) and labels again.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDraftLabelArgs, FORMAL_AI_DRAFT_LABEL, labelDraftPullRequest, labelPullRequestArgs } from '../scripts/formal-ai-draft.lib.mjs';

const fakeGh = ({ labelExists }) => {
  const calls = [];
  let exists = labelExists;
  const gh = async args => {
    calls.push(args);
    if (args[0] === 'label' && args[1] === 'create') {
      exists = true;
      return '';
    }
    if (args.includes('--add-label') && !exists) throw new Error(`Command failed: gh ${args.join(' ')}\n'${FORMAL_AI_DRAFT_LABEL}' not found\n`);
    return '';
  };
  return { gh, calls };
};

test('the label is created with a description when it is missing', () => {
  const args = createDraftLabelArgs({ repository: 'o/r' });
  assert.deepEqual(args.slice(0, 3), ['label', 'create', FORMAL_AI_DRAFT_LABEL]);
  assert.ok(args.includes('--description'));
  assert.ok(!args.includes('--force'), 'an existing label keeps its colour and description');
  assert.deepEqual(args.slice(-2), ['--repo', 'o/r']);
});

test('an existing label is applied with a single call', async () => {
  const { gh, calls } = fakeGh({ labelExists: true });
  await labelDraftPullRequest({ gh, repository: 'o/r', number: 2616 });
  assert.deepEqual(calls, [labelPullRequestArgs({ repository: 'o/r', number: 2616 })]);
});

test('a missing label is created, then applied', async () => {
  const { gh, calls } = fakeGh({ labelExists: false });
  await labelDraftPullRequest({ gh, repository: 'o/r', number: 2616 });
  assert.deepEqual(calls, [labelPullRequestArgs({ repository: 'o/r', number: 2616 }), createDraftLabelArgs({ repository: 'o/r' }), labelPullRequestArgs({ repository: 'o/r', number: 2616 })]);
});

test('other labelling errors are not hidden', async () => {
  const gh = async () => {
    throw new Error('HTTP 403: Resource not accessible by integration');
  };
  await assert.rejects(labelDraftPullRequest({ gh, repository: 'o/r', number: 1 }), /Resource not accessible/);
});

test('the workflow script labels through the helper', async () => {
  const { readFileSync } = await import('node:fs');
  const script = readFileSync(new URL('../scripts/formal-ai-draft.mjs', import.meta.url), 'utf8');
  assert.match(script, /await labelDraftPullRequest\(\{ gh, repository, number: pullRequest\.number \}\);/);
  assert.doesNotMatch(script, /await gh\(labelPullRequestArgs/);
});
