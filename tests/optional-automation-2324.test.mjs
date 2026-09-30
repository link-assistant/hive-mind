/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { decideDraft } from '../scripts/formal-ai-draft.lib.mjs';
import { buildE2eSolveArgv } from '../scripts/e2e-hello-world.lib.mjs';
import { buildFormalAiSidecarRunArgs } from '../src/formal-ai-sidecar.lib.mjs';
import * as freshness from '../scripts/dependency-freshness.lib.mjs';

test('a human issue is attempted in every credential layer', () => {
  for (const layer of ['default', 'token', 'app']) {
    const decision = decideDraft({ action: 'opened', issue: { number: 1, user: { type: 'User' } }, layer });
    assert.equal(decision.run, true);
    assert.equal(decision.checkStrategy, layer === 'default' ? 'dispatch' : 'pull_request');
  }
});

test('every matrix row targets its isolated base branch', () => {
  const baseBranch = 'e2e/hello-world/123/agent-formal-ai';
  const args = buildE2eSolveArgv({ issueUrl: 'https://github.com/o/r/issues/1', tool: 'agent', model: 'formal-ai', baseBranch });
  assert.equal(args[args.indexOf('--base-branch') + 1], baseBranch);
});

test('the task sidecar carries the workspace install grant', () => {
  assert.ok(buildFormalAiSidecarRunArgs({ image: 'fixture', env: {} }).includes('FORMAL_AI_INSTALL_GRANT=workspace'));
  assert.ok(buildFormalAiSidecarRunArgs({ image: 'fixture', env: { FORMAL_AI_INSTALL_GRANT: 'deny' } }).includes('FORMAL_AI_INSTALL_GRANT=deny'));
});

test('unmapped Docker version arguments fail closed instead of disappearing', () => {
  assert.equal(typeof freshness.parseDockerDependencyPins, 'function');
  const records = freshness.parseDockerDependencyPins('ARG NEW_TOOL_VERSION=1.2.3\nRUN cargo install example --version 1.0.0\nFROM alpine:3.20.1\n', 'Dockerfile.fixture');
  assert.ok(records.some(record => record.kind === 'unresolved' && record.name === 'NEW_TOOL_VERSION'));
  assert.ok(records.some(record => record.kind === 'crate' && record.name === 'example'));
  assert.ok(records.some(record => record.kind === 'container' && record.name === 'alpine'));
});

test('manual checks default safely and e2e PRs do not run the host CI', () => {
  for (const file of ['release', 'security', 'links', 'workflows']) {
    const source = readFileSync(`.github/workflows/${file}.yml`, 'utf8');
    assert.match(source, /branches-ignore: \['e2e\/\*\*'\]/);
    assert.match(source, /mode:[\s\S]*default: ['"]?checks/);
  }
  const release = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(release, /instant-release:[\s\S]*github\.ref == 'refs\/heads\/main'/);
});

import { selectAutomationToken, probeRepositoryCapabilities } from '../scripts/automation-token.lib.mjs';
import { createBranchFixture, cleanupBranchFixture } from '../scripts/task-fixture.lib.mjs';
import { verifyGeneratedWorkflow } from '../scripts/e2e-workflow.lib.mjs';

test('credentials prefer the app, then one token, then the default', () => {
  assert.deepEqual(selectAutomationToken({ appToken: 'a', token: 'b', defaultToken: 'c' }), { token: 'a', layer: 'app', triggersWorkflows: true });
  assert.equal(selectAutomationToken({ token: 'b', defaultToken: 'c' }).layer, 'token');
  assert.deepEqual(selectAutomationToken({ defaultToken: 'c' }), { token: 'c', layer: 'default', triggersWorkflows: false });
});

test('default and unknown capabilities cannot authorize repository operations', async () => {
  const request = async () => {
    throw new Error('Unavailable');
  };
  for (const layer of ['default', 'app', 'token']) assert.deepEqual(await probeRepositoryCapabilities({ token: 'fixture', layer, owner: 'o', fetchImpl: request }), { canCreateRepositories: false, canDeleteRepositories: false });
  assert.deepEqual(await probeRepositoryCapabilities({ token: 'fixture', layer: 'token', owner: 'o', fetchImpl: async () => ({ ok: true, headers: new globalThis.Headers({ 'x-oauth-scopes': 'repo, delete_repo' }), json: async () => ({ login: 'o' }) }) }), { canCreateRepositories: true, canDeleteRepositories: true });
});

test('an orphan fixture contains only the README and persists partial resources', async () => {
  const calls = [],
    resources = [];
  const api = async (endpoint, options) => {
    calls.push({ endpoint, ...options });
    return endpoint.endsWith('/issues') ? { number: 7, html_url: 'https://github.com/o/r/issues/7' } : { sha: 'fixture' };
  };
  const fixture = await createBranchFixture({ repository: 'o/r', baseBranch: 'e2e/hello-world/1/agent-formal-ai', readme: 'task', title: 'Hello', body: 'body', api, runGh: async () => {}, onResource: resource => resources.push(globalThis.structuredClone(resource)) });
  assert.deepEqual(calls.find(call => call.endpoint.endsWith('/git/trees')).body, { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'fixture' }] });
  assert.deepEqual(calls.find(call => call.endpoint.endsWith('/git/commits')).body.parents, []);
  assert.ok(resources[0].branches.includes(fixture.baseBranch));
  assert.equal(fixture.issueNumber, 7);
  assert.ok(calls.find(call => call.endpoint.endsWith('/issues')).body.labels.includes('e2e-task'));
});

test('cleanup tries every resource even after one API error', async () => {
  const calls = [];
  const errors = await cleanupBranchFixture(
    { repository: 'o/r', pullRequestNumber: 2, issueNumber: 1, branches: ['base', 'head'] },
    {
      api: async (endpoint, options) => {
        calls.push([endpoint, options.method]);
        if (endpoint.includes('/pulls/')) throw new Error('403');
      },
    }
  );
  assert.equal(errors.length, 1);
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.slice(-2).map(call => call[0]),
    ['repos/o/r/git/refs/heads/head', 'repos/o/r/git/refs/heads/base']
  );
});

const generatedRun = { id: 12, name: 'Hello', path: '.github/workflows/run.yml', event: 'pull_request', head_sha: 'sha', html_url: 'https://github.com/o/r/actions/runs/12', status: 'completed', conclusion: 'success' };
const verificationArgs = { repository: 'o/r', pullRequest: { headRefOid: 'sha' }, workflows: ['.github/workflows/run.yml'], timeoutMs: 10, discoveryMs: 0, now: () => 20, runGh: async () => 'Hello, World!\n' };

test('real Actions conclusions and logs are verified without act', async () => {
  const result = await verifyGeneratedWorkflow({ ...verificationArgs, layer: 'app', api: async () => [{ workflow_runs: [generatedRun] }], runAct: () => assert.fail('Unexpected act') });
  assert.equal(result.mode, 'actions');
  assert.equal(result.checks[0].conclusion, 'SUCCESS');
  assert.equal(result.workflowLog, 'Hello, World!\n');
});

test('default-token approval refusal is recorded before act fallback', async () => {
  const requests = [];
  const result = await verifyGeneratedWorkflow({
    ...verificationArgs,
    api: async (endpoint, options) => {
      requests.push({ endpoint, options });
      if (options?.method === 'POST') throw new Error('HTTP 403: approval refused');
      return [{ workflow_runs: [{ ...generatedRun, status: 'waiting', conclusion: null }] }];
    },
    runAct: async () => ({ code: 0, stdout: 'Hello, World!\n' }),
  });
  assert.equal(requests[1].endpoint, 'repos/o/r/actions/runs/12/approve');
  assert.equal(result.approval[0].outcome, 'refused');
  assert.equal(result.mode, 'act');
  assert.equal(result.checks[0].conclusion, 'SUCCESS');
});

test('an approved run is awaited and its real result is retained', async () => {
  let calls = 0;
  const result = await verifyGeneratedWorkflow({ ...verificationArgs, api: async (_, options) => (options?.method === 'POST' ? null : [{ workflow_runs: [{ ...generatedRun, status: calls++ ? 'completed' : 'waiting' }] }]), sleepImpl: async () => {} });
  assert.equal(result.mode, 'approved-actions');
  assert.equal(result.approval[0].outcome, 'approved');
});

test('no generated run records the platform limitation and uses act only for default credentials', async () => {
  const result = await verifyGeneratedWorkflow({ ...verificationArgs, api: async () => [{ workflow_runs: [] }], runAct: async () => ({ code: 1, stdout: 'compiler failed' }) });
  assert.equal(result.mode, 'act');
  assert.deepEqual(result.approval, []);
  assert.match(result.fallbackReason, /No generated/);
  assert.equal(result.checks[0].conclusion, 'FAILURE');
  let time = 0;
  const app = await verifyGeneratedWorkflow({ ...verificationArgs, layer: 'app', now: () => time++, api: async () => [{ workflow_runs: [] }], sleepImpl: async () => {}, runAct: () => assert.fail('App must verify real Actions') });
  assert.equal(app.checks[0].conclusion, 'FAILURE');
  assert.equal(app.mode, 'actions');
});

test('lowered pins fail, open issues waive them, closed issues and registry failures fail closed', async () => {
  const record = { kind: 'npm', name: 'fixture', current: '1.0.0', location: 'Dockerfile:1', policy: 'exact' };
  const options = { resolveNpmLatest: async () => '1.1.0', resolveOpenIssue: async () => true };
  assert.equal((await freshness.checkDependencyRecords([record], options)).stale.length, 1);
  assert.equal((await freshness.checkDependencyRecords([{ ...record, exception: 'https://github.com/o/r/issues/1' }], options)).exceptions.length, 1);
  assert.equal((await freshness.checkDependencyRecords([{ ...record, exception: 'https://github.com/o/r/issues/1' }], { ...options, resolveOpenIssue: async () => false })).errors.length, 1);
  assert.equal(
    (
      await freshness.checkDependencyRecords([record], {
        resolveNpmLatest: async () => {
          throw new Error('HTTP 500');
        },
      })
    ).errors.length,
    1
  );
});

test('scoped app tokens cannot operate on repositories, administration requires an explicit successful grant', async () => {
  const request = async () => ({ ok: true });
  assert.deepEqual(await probeRepositoryCapabilities({ token: 'fixture', layer: 'app', owner: 'o', fetchImpl: request }), { canCreateRepositories: false, canDeleteRepositories: false });
  assert.deepEqual(await probeRepositoryCapabilities({ token: 'fixture', layer: 'app', owner: 'o', administrationGranted: true, fetchImpl: request }), { canCreateRepositories: true, canDeleteRepositories: true });
});

test('freshness uses the selected GH_TOKEN for GitHub registry requests', async () => {
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'selected-fixture';
  try {
    await freshness.resolveGitHubLatest(
      'o/r',
      {},
      {
        fetchImpl: async (_, { headers }) => {
          assert.equal(headers.authorization, 'Bearer selected-fixture');
          return { ok: true, json: async () => [{ name: 'v1.0.0' }] };
        },
      }
    );
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
  }
});
