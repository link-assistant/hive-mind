/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareSharedActions } from '../scripts/prepare-shared-github-actions.lib.mjs';
import { resolveCredentials } from '../.github/actions/shared-github-fallback/actions/resolve-github-token/resolve.mjs';
import { dispatchChecks } from '../.github/actions/shared-github-fallback/actions/dispatch-checks/dispatch.mjs';

test('unpublished shared actions stage the complete compatibility implementation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-actions-'));
  try {
    const warnings = [];
    const source = await prepareSharedActions({ root, api: async () => ({ sha: 'abc', tree: [] }), log: message => warnings.push(message) });
    assert.equal(source, 'compatibility');
    for (const action of ['resolve-github-token', 'dispatch-checks']) {
      assert.match(readFileSync(join(root, 'actions', action, 'action.yml'), 'utf8'), /using: composite/);
    }
    assert.match(warnings.join('\n'), /unpublished/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('published actions are used together from the same immutable upstream commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-actions-'));
  try {
    const tree = ['resolve-github-token', 'dispatch-checks'].map(action => ({ path: `actions/${action}/action.yml`, type: 'blob' }));
    const source = await prepareSharedActions({
      root,
      api: async () => ({ sha: 'immutable', tree }),
      log: () => {},
      download: (sha, destination) => {
        assert.equal(sha, 'immutable');
        for (const entry of tree) {
          mkdirSync(join(destination, entry.path, '..'), { recursive: true });
          writeFileSync(join(destination, entry.path), 'upstream implementation');
        }
      },
    });
    assert.equal(source, 'upstream');
    assert.equal(readFileSync(join(root, tree[0].path), 'utf8'), 'upstream implementation');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('upstream transport failures remain failures instead of silently selecting fallback', async () => {
  await assert.rejects(
    prepareSharedActions({
      api: async () => {
        throw new Error('HTTP 503');
      },
    }),
    /HTTP 503/
  );
});

test('resolver preserves App, single-token, and built-in precedence and capabilities', async () => {
  let probes = 0;
  const capability = async () => {
    probes++;
    return true;
  };
  assert.deepEqual(await resolveCredentials({ appId: '1', appPrivateKey: 'configured', appToken: 'app-value', token: 'pat-value', defaultToken: 'default-value' }, capability), { token: 'app-value', layer: 'app', triggersWorkflows: true, canCreateRepositories: true });
  assert.equal((await resolveCredentials({ token: 'pat-value', defaultToken: 'default-value' }, capability)).layer, 'token');
  assert.deepEqual(await resolveCredentials({ defaultToken: 'default-value' }, capability), { token: 'default-value', layer: 'default', triggersWorkflows: false, canCreateRepositories: false });
  assert.equal(probes, 2, 'the built-in token never probes user-only endpoints');
  await assert.rejects(resolveCredentials({ appId: '1', appPrivateKey: 'configured', defaultToken: 'default-value' }, capability), /App token/);
});

test('dispatch runs checks on the requested ref and reports the matching new head run', async () => {
  const calls = [];
  let polls = 0;
  const api = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (endpoint.includes('/git/ref/')) return { object: { sha: 'new-head' } };
    if (options.method === 'POST') return null;
    if (endpoint.endsWith('/runs?per_page=100')) {
      polls++;
      return { workflow_runs: polls === 1 ? [{ id: 1 }] : [{ id: 1 }, { id: 2, head_sha: 'new-head', head_branch: 'issue-2323', event: 'workflow_dispatch', html_url: 'https://github.com/o/r/actions/runs/2' }] };
    }
    throw new Error(`Unexpected API call ${endpoint}`);
  };
  assert.deepEqual(await dispatchChecks({ repository: 'o/r', ref: 'issue-2323', workflows: 'release.yml', api, sleep: async () => {} }), ['https://github.com/o/r/actions/runs/2']);
  assert.deepEqual(calls.find(call => call.method === 'POST').body, { ref: 'issue-2323', inputs: { mode: 'checks' } });
});

test('dispatch is bounded when no matching run appears', async () => {
  const api = async endpoint => (endpoint.includes('/git/ref/') ? { object: { sha: 'head' } } : { workflow_runs: [] });
  await assert.rejects(dispatchChecks({ repository: 'o/r', ref: 'branch', workflows: 'release.yml', api, attempts: 2, sleep: async () => {} }), /No dispatched run/);
});

test('workflow setup never statically preloads an unpublished action and prepares after checkout', () => {
  for (const name of ['release', 'release-helm', 'security', 'formal-ai-draft', 'cleanup-test-repos', 'e2e-hello-world-matrix']) {
    const source = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
    assert.doesNotMatch(source, /uses: link-foundation\/\.github\/actions\//, name);
    for (const job of source.split(/\n {2}[\w-]+:\n/).slice(1)) {
      if (!job.includes('id: gh')) continue;
      assert.ok(job.includes('actions/checkout@'), `${name}: local actions require checkout`);
      assert.ok(job.indexOf('actions/checkout@') < job.indexOf('uses: ./.github/actions/resolve-github-token'), name);
    }
  }
  const loader = readFileSync('.github/actions/resolve-github-token/action.yml', 'utf8');
  assert.ok(loader.indexOf('prepare-shared-github-actions') < loader.indexOf('id: gh'));
});
