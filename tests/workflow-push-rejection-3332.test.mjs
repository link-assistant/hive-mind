#!/usr/bin/env node

/**
 * Issue #3332: GitHub rejects a whole push that touches .github/workflows
 * when the credential lacks the workflows permission. solve itself (not only
 * the e2e harness) reports that on the pull request as a credential problem,
 * and a rejection a later push recovered from is not reported.
 *
 * @hive-mind-test-suite default
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { isToolGeneratedComment } from '../src/tool-comments.lib.mjs';
import { buildWorkflowPushRejectedComment, detectWorkflowPushRejection, detectWorkflowPushRejections, reportWorkflowPushRejection } from '../src/workflow-push-rejection.lib.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
// run 38616580354, agent / nemotron-3-super-free, solve.log (as JSON-escaped tool output)
const REJECTED = '{"type":"tool_result","output":"To https://github.com/o/r.git\\n ! [remote rejected] issue-3308-abc -> issue-3308-abc (refusing to allow a GitHub App to create or update workflow `.github/workflows/test-hello-world.yml` without `workflows` permission)\\nerror: failed to push some refs"}';

const fakeDollar = ({ files = [], filesCode = 0, posted = [] } = {}) => {
  const $ = (...args) => {
    if (!Array.isArray(args[0])) return $;
    const command = String.raw({ raw: args[0] }, ...args.slice(1));
    if (command.includes('/files')) return Promise.resolve({ code: filesCode, stdout: files.join('\n') });
    posted.push(command);
    return Promise.resolve({ code: 0, stdout: '{"id":1}' });
  };
  return $;
};

test('every rejected workflow is found once, plain or JSON-escaped', () => {
  assert.deepEqual(detectWorkflowPushRejections(`${REJECTED}\n${REJECTED}`), [{ workflow: '.github/workflows/test-hello-world.yml', credential: 'GitHub App' }]);
  assert.equal(detectWorkflowPushRejection('remote: refusing to allow a Personal Access Token to create or update workflow `.github/workflows/ci.yml` without `workflow` scope').credential, 'Personal Access Token');
  assert.equal(detectWorkflowPushRejection('🎉 SUCCESS'), null);
});

test('a workflow a later push delivered is not reported', () => {
  assert.equal(detectWorkflowPushRejection(REJECTED, { files: ['.github/workflows/test-hello-world.yml', 'hello.scala'] }), null);
  assert.equal(detectWorkflowPushRejection(REJECTED, { files: ['.gitkeep'] }).workflow, '.github/workflows/test-hello-world.yml');
});

test('the notice names the credential fix and is recognised as a tool comment', () => {
  const app = buildWorkflowPushRejectedComment({ workflow: '.github/workflows/ci.yml', credential: 'GitHub App' });
  assert.match(app, /Workflows: read and write/);
  assert.ok(isToolGeneratedComment(app), 'it is never counted as the AI commenting');
  assert.match(buildWorkflowPushRejectedComment({ workflow: '.github/workflows/ci.yml', credential: 'OAuth App' }), /gh auth refresh -s workflow/);
});

test('solve posts the notice only when the workflow is still missing from the pull request', async () => {
  const logs = [];
  const log = async message => logs.push(message);
  const posted = [];
  const missing = await reportWorkflowPushRejection({ owner: 'o', repo: 'r', prNumber: 7, logText: REJECTED, $: fakeDollar({ files: ['.gitkeep'], posted }), log });
  assert.equal(missing.workflow, '.github/workflows/test-hello-world.yml');
  assert.ok(logs.some(line => line.includes('Workflow push rejected')));
  assert.equal(posted.length, 1, 'one notice is posted on the pull request');

  const recoveredPosts = [];

  const recovered = await reportWorkflowPushRejection({ owner: 'o', repo: 'r', prNumber: 7, logText: REJECTED, $: fakeDollar({ files: ['.github/workflows/test-hello-world.yml'], posted: recoveredPosts }), log });
  assert.equal(recovered, null);
  assert.equal(recoveredPosts.length, 0);
  assert.equal(await reportWorkflowPushRejection({ owner: 'o', repo: 'r', prNumber: 7, logText: 'no rejection', $: fakeDollar(), log }), null);
});

test('verifyResults and the e2e harness share the detector', () => {
  const results = fs.readFileSync(path.join(repositoryRoot, 'src', 'solve.results.lib.mjs'), 'utf8');
  assert.match(results, /await reportWorkflowPushRejection\(\{ owner, repo, prNumber: pr\.number, logText, \$, log \}\)/);
  const harness = fs.readFileSync(path.join(repositoryRoot, 'scripts', 'e2e-matrix-harness.lib.mjs'), 'utf8');
  assert.match(harness, /import \{ detectWorkflowPushRejection \} from '\.\.\/src\/workflow-push-rejection\.lib\.mjs'/);
  const e2e = fs.readFileSync(path.join(repositoryRoot, 'scripts', 'e2e-hello-world.mjs'), 'utf8');
  assert.match(e2e, /detectWorkflowPushRejection\(solveLog, \{ files: pullRequest \? files : null \}\)/);
});
