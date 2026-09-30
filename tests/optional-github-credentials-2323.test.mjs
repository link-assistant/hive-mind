/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { decideDraft } from '../scripts/formal-ai-draft.lib.mjs';

const workflow = name => readFileSync(`.github/workflows/${name}.yml`, 'utf8');
const issue = { number: 2323, labels: [], user: { login: 'human', type: 'User' } };

test('a missing optional token still attempts a draft and dispatches checks', () => {
  const decision = decideDraft({ action: 'opened', issue, hasToken: false });
  assert.equal(decision.run, true);
  assert.equal(decision.checkStrategy, 'dispatch');
  assert.notEqual(decision.code, 'no-draft-token');
});

test('all credential layers choose their check strategy without skipping', () => {
  for (const layer of ['app', 'token', 'default']) {
    const decision = decideDraft({ action: 'opened', issue, layer });
    assert.equal(decision.run, true);
    assert.equal(decision.checkStrategy, layer === 'default' ? 'dispatch' : 'pull_request');
  }
});

test('workflows use one shared resolver and remove workload-specific secrets', () => {
  for (const name of readdirSync('.github/workflows').filter(name => name.endsWith('.yml'))) {
    assert.doesNotMatch(readFileSync(`.github/workflows/${name}`, 'utf8'), /secrets\.(?:FORMAL_AI_DRAFT_TOKEN|E2E_GITHUB_TOKEN|TEST_GITHUB_USER_TOKEN|TEST_GITHUB_USER_REPO_DELETION_TOKEN)\b/, name);
  }
  for (const name of ['formal-ai-draft', 'e2e-hello-world-matrix', 'cleanup-test-repos', 'release', 'release-helm', 'security']) {
    assert.match(workflow(name), /uses: link-foundation\/\.github\/actions\/resolve-github-token@/);
    assert.match(workflow(name), /default-token: \$\{\{ github.token \}\}/);
    assert.match(workflow(name), /token: \$\{\{ secrets.AUTOMATION_TOKEN \}\}/);
  }
});

test('dispatch defaults to checks and release jobs require an explicit mode on main', () => {
  for (const name of ['release', 'security', 'links', 'workflows']) {
    assert.match(workflow(name), /mode:\s*\n[^]*?default: ['"]?checks/);
  }
  const release = workflow('release');
  assert.match(release, /release_mode:[^]*?default: ['"]checks['"]/);
  for (const name of ['instant-release', 'changeset-pr']) {
    const job = release.split(`\n  ${name}:\n`)[1].split(/\n {2}[a-z][\w-]*:\n/)[0];
    assert.match(job, /if:[^\n]*github.ref == 'refs\/heads\/main'/);
    assert.match(job, /if:[^\n]*inputs.mode != 'checks'/);
  }
});

test('default-token drafts dispatch the four checks even after a failed solve', () => {
  const draft = workflow('formal-ai-draft');
  assert.match(draft, /uses: link-foundation\/\.github\/actions\/dispatch-checks@/);
  assert.match(draft, /if:[^\n]*!cancelled\(\)[^\n]*head_ref/);
  for (const file of ['release.yml', 'security.yml', 'links.yml', 'workflows.yml']) assert.ok(draft.includes(file));
});
