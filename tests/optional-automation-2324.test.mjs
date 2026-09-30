/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('stale cleanup also removes the task head after its pull request was closed', () => {
  const operations = JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', 'experiments/issue-2324/stale-fixture-cleanup-probe.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.ok(operations.some(operation => operation.method === 'DELETE' && operation.endpoint.endsWith('/issue-1-fixture')));
  assert.ok(operations.some(operation => operation.method === 'DELETE' && operation.endpoint.endsWith('/e2e/hello-world/1/agent-formal-ai')));
  assert.ok(
    operations.every(operation => operation.method === 'DELETE'),
    'already closed pull requests need no mutation'
  );
});

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
  assert.match(readFileSync('.github/workflows/e2e-hello-world-matrix.yml', 'utf8'), /hello-world:[\s\S]*permissions:[\s\S]*actions: read/);
});

test('the task sidecar carries the workspace install grant', () => {
  assert.ok(buildFormalAiSidecarRunArgs({ image: 'fixture', env: {} }).includes('FORMAL_AI_INSTALL_GRANT=workspace'));
  assert.ok(buildFormalAiSidecarRunArgs({ image: 'fixture', env: { FORMAL_AI_INSTALL_GRANT: 'deny' } }).includes('FORMAL_AI_INSTALL_GRANT=deny'));
});

test('matrix dry-run logs forward credential names without exposing their values', () => {
  const output = execFileSync(process.execPath, ['scripts/e2e-hello-world.mjs', '--tool', 'agent', '--model', 'formal-ai', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: 'fixture-private-github-token', OPENAI_API_KEY: 'fixture-private-model-key' },
  });
  assert.match(output, /-e GH_TOKEN/);
  assert.match(output, /hive-e2e:candidate \/opt\/hive-e2e\/src\/solve\.mjs/);
  assert.doesNotMatch(output, /fixture-private/);
  assert.doesNotMatch(output, /-e OPENAI_API_KEY/);
});

test('the task overlay installs packages as the runtime user', () => {
  const dockerfile = readFileSync('Dockerfile.e2e', 'utf8');
  let user = 'root';
  for (const line of dockerfile.split('\n')) {
    if (line.startsWith('USER ')) user = line.slice(5).trim();
    if (/^RUN .*\b(?:npm|bun)\b/.test(line)) assert.equal(user, 'box', 'package installs must not leave root-owned cache entries in the task user home');
  }
  assert.match(dockerfile, /COPY --chown=box:box package\.json package-lock\.json/);
});

test('unmapped Docker version arguments fail closed instead of disappearing', () => {
  assert.equal(typeof freshness.parseDockerDependencyPins, 'function');
  const records = freshness.parseDockerDependencyPins('ARG NEW_TOOL_VERSION=1.2.3\nRUN cargo install example --version 1.0.0\nFROM alpine:3.20.1\n', 'Dockerfile.fixture');
  assert.ok(records.some(record => record.kind === 'unresolved' && record.name === 'NEW_TOOL_VERSION'));
  assert.ok(records.some(record => record.kind === 'crate' && record.name === 'example'));
  assert.ok(records.some(record => record.kind === 'container' && record.name === 'alpine'));
});

test('container freshness compares stable tags of each flavor independently', async () => {
  const records = ['1.0.0-alpine', '2.0.0-bookworm'].map(current => ({ kind: 'container', name: 'example/image', current, policy: 'exact', location: `Dockerfile:${current}` }));
  const result = await freshness.checkDependencyRecords(records, {
    resolveContainerLatest: (name, record) =>
      freshness.resolveContainerLatest(name, record, {
        fetchImpl: async () => ({ ok: true, json: async () => ({ tags: ['1.0.0-alpine', '2.0.0-bookworm', '3.0.0-rc.1-alpine'] }) }),
      }),
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.current.length, 2);
  assert.equal(result.stale.length, 0);
});

test('a single-component repository in a custom registry has no Docker Hub library prefix', async () => {
  const latest = await freshness.resolveContainerLatest(
    'registry.example/image',
    { current: '1.0.0' },
    {
      fetchImpl: async url => {
        assert.equal(url, 'https://registry.example/v2/image/tags/list');
        return { ok: true, json: async () => ({ tags: ['1.0.0', '1.1.0'] }) };
      },
    }
  );
  assert.equal(latest, '1.1.0');
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

test('standalone automation jobs install GitHub helper dependencies before running scripts', () => {
  for (const [file, name, invocation] of [
    ['e2e-hello-world-matrix', 'prepare', 'node scripts/e2e-matrix-schedule.mjs'],
    ['e2e-hello-world-matrix', 'hello-world', 'node scripts/e2e-hello-world.mjs'],
    ['cleanup-test-repos', 'cleanup', 'node scripts/cleanup-task-fixtures.mjs'],
    ['formal-ai-draft', 'health', 'node scripts/formal-ai-draft-health.mjs'],
    ['formal-ai-draft', 'draft', 'uses: ./.github/actions/dispatch-checks'],
  ]) {
    const source = readFileSync(`.github/workflows/${file}.yml`, 'utf8');
    const job = source.split(/^ {2}(?=[A-Za-z0-9_-]+:$)/m).find(block => block.startsWith(`${name}:`));
    const install = job.indexOf('npm ci --omit=dev --ignore-scripts');
    assert.ok(install >= 0 && install < job.indexOf(invocation), `${file}/${name} installs runtime dependencies first`);
  }
});

test('every release job checks out the local credential action before using it', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  for (const name of ['release', 'instant-release', 'helm-release', 'helm-release-instant', 'changeset-pr']) {
    const job = workflow.split(/^ {2}(?=[A-Za-z0-9_-]+:$)/m).find(block => block.startsWith(`${name}:`));
    assert.ok(job.indexOf('uses: actions/checkout@') < job.indexOf('uses: ./.github/actions/resolve-github-token'), `${name} checks out its local action first`);
  }
});
