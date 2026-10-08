/**
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1782
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyGitHubRelease, verifyPages, containsCommit, monitorCiCd, collectCiCdHealth } from '../src/solve.auto-fix-ci-cd.github.lib.mjs';
import { verifyPackagePublications } from '../src/solve.auto-fix-ci-cd.packages.lib.mjs';
import { createYargsConfig, SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';
import { getMergedCiCdTarget, getRepairCiCdTarget } from '../src/solve.auto-fix-ci-cd.lib.mjs';
import { createYargsConfig as createHiveConfig } from '../src/hive.config.lib.mjs';

const repository = { fullName: 'o/r' };
const target = { sha: 'merge', branch: 'main', since: '2026-01-01T00:00:00Z' };
const green = [{ name: 'Release', status: 'completed', conclusion: 'success' }];
function mockApi(routes) {
  return async (command, args) => {
    assert.equal(command, 'gh');
    const endpoint = args[1];
    assert.ok(Object.hasOwn(routes, endpoint), `Unexpected API request: ${endpoint}`);
    const value = routes[endpoint];
    return value instanceof Error ? { code: 1, stdout: '', stderr: value.message } : { code: 0, stdout: JSON.stringify(value), stderr: '' };
  };
}

test('CLI and Telegram parser require auto-merge; option is opt-in', async () => {
  assert.equal(SOLVE_OPTION_DEFINITIONS['auto-fix-ci-cd'].default, false);
  const parse = args =>
    createYargsConfig(getLinoYargsFactory()())
      .exitProcess(false)
      .parse(['https://github.com/o/r/issues/1', ...args]);
  await assert.rejects(async () => parse(['--auto-fix-ci-cd']), /requires --auto-merge/);
  assert.equal((await parse(['--auto-fix-ci-cd', '--auto-merge'])).autoFixCiCd, true);
  assert.equal((await parse(['--no-auto-fix-ci-cd'])).autoFixCiCd, false);
  const parseHive = args =>
    createHiveConfig(getLinoYargsFactory()())
      .exitProcess(false)
      .parse(['https://github.com/o/r', ...args]);
  await assert.rejects(async () => parseHive(['--auto-fix-ci-cd']), /requires --auto-merge/);
  assert.equal((await parseHive(['--auto-merge', '--auto-fix-ci-cd'])).autoFixCiCd, true);
});

test('only an actually merged PR starts publication checks', async () => {
  const run = async (_command, args) => {
    assert.ok(args.includes('state,mergedAt,mergeCommit,baseRefName'));
    return { code: 0, stdout: JSON.stringify({ state: 'OPEN' }) };
  };
  assert.equal(await getMergedCiCdTarget({ repository, prNumber: 1, run }), null);
  const mergedRun = async () => ({ code: 0, stdout: JSON.stringify({ state: 'MERGED', mergedAt: target.since, baseRefName: 'main', mergeCommit: { oid: 'merge' } }) });
  assert.deepEqual(await getMergedCiCdTarget({ repository, prNumber: 1, run: mergedRun }), target);
});

test('repair verification follows the merged repair PR even when a release bot advances HEAD', async () => {
  const run = async (_command, args) => {
    if (args[0] === 'issue') return { code: 0, stdout: JSON.stringify({ closedByPullRequestsReferences: [{ number: 2 }] }) };
    assert.equal(args[0], 'pr', 'must not replace the repair merge with a later version-bump HEAD');
    return { code: 0, stdout: JSON.stringify({ state: 'MERGED', mergedAt: target.since, baseRefName: 'main', mergeCommit: { oid: 'merge' } }) };
  };
  assert.deepEqual(await getRepairCiCdTarget({ repository, issue: { url: 'https://github.com/o/r/issues/2' }, branch: 'main', run }), target);
  await assert.rejects(getRepairCiCdTarget({ repository, issue: { url: 'https://github.com/o/r/issues/2' }, branch: 'stable', run }), /no merged pull request/);
});

test('a published release must be fresh and its tag must include the merge', async () => {
  const routes = {
    'repos/o/r/releases?per_page=100': [
      [
        { draft: true, published_at: '2026-01-02T00:00:00Z', tag_name: 'draft' },
        { published_at: '2025-12-31T00:00:00Z', tag_name: 'old' },
        { published_at: 'invalid timestamp', tag_name: 'invalid-date' },
        { published_at: '2026-01-02T00:00:00Z', tag_name: 'unrelated' },
        { published_at: '2026-01-02T00:00:00Z', tag_name: 'v1', target_commitish: 'main' },
      ],
    ],
    'repos/o/r/commits/unrelated': { sha: 'other' },
    'repos/o/r/compare/merge...other': { status: 'diverged' },
    'repos/o/r/commits/v1': { sha: 'version-bump' },
    'repos/o/r/compare/merge...version-bump': { status: 'ahead' },
  };
  const result = await verifyGitHubRelease({ repository, target, run: mockApi(routes) });
  assert.equal(result.verified, true);
  assert.equal(result.detail, 'v1');
  routes['repos/o/r/compare/merge...version-bump'] = { status: 'behind' };
  assert.equal((await verifyGitHubRelease({ repository, target, run: mockApi(routes) })).verified, false);
});

test('Pages latest deployment status must succeed for the merged change', async () => {
  const routes = {
    'repos/o/r/deployments?environment=github-pages&per_page=100': [[{ id: 1, sha: 'merge', created_at: '2026-01-02T00:00:00Z' }]],
    'repos/o/r/deployments/1/statuses?per_page=100': [[{ state: 'failure' }, { state: 'success' }]],
  };
  assert.equal((await verifyPages({ repository, target, run: mockApi(routes) })).verified, false);
  routes['repos/o/r/deployments/1/statuses?per_page=100'] = [[{ state: 'success', environment_url: 'https://o.github.io/r' }]];
  assert.equal((await verifyPages({ repository, target, run: mockApi(routes) })).verified, true);
});

test('branch-based Pages must report a fresh built commit', async () => {
  const routes = {
    'repos/o/r/deployments?environment=github-pages&per_page=100': [[]],
    'repos/o/r/pages/builds/latest': { status: 'built', commit: 'merge', created_at: '2026-01-02T00:00:00Z' },
  };
  assert.equal((await verifyPages({ repository, target, run: mockApi(routes) })).verified, true);
  routes['repos/o/r/pages/builds/latest'].created_at = '2025-01-01T00:00:00Z';
  assert.equal((await verifyPages({ repository, target, run: mockApi(routes) })).verified, false);
});

test('deployment without a timestamp cannot count as a fresh deployment', async () => {
  const routes = {
    'repos/o/r/deployments?environment=github-pages&per_page=100': [[{ id: 1, sha: 'merge' }]],
    'repos/o/r/pages/builds/latest': { status: 'built', commit: 'merge', created_at: 'invalid timestamp' },
  };
  assert.equal((await verifyPages({ repository, target, run: mockApi(routes) })).verified, false);
});

test('registries must contain the expected version, published after merge', async () => {
  const files = new Map([
    ['package.json', JSON.stringify({ name: '@o/pkg', version: '1.2.3' })],
    ['pyproject.toml', '[project]\nname = "python-pkg"\nversion = "1.2.3"\n'],
    ['Cargo.toml', '[package]\nname = "rust-pkg"\nversion = "1.2.3"\n'],
    ['private/package.json', JSON.stringify({ private: true })],
  ]);
  const urls = [];
  const fetchJson = async url => {
    urls.push(url);
    if (url.includes('npmjs')) return { versions: { '1.2.3': {} }, time: { '1.2.3': '2026-01-02T00:00:00Z' } };
    if (url.includes('pypi')) return { info: { version: '1.2.3' }, urls: [{ upload_time_iso_8601: '2026-01-02T00:00:00Z' }] };
    return { version: { num: '1.2.3', created_at: '2026-01-02T00:00:00Z' } };
  };
  const result = await verifyPackagePublications({ kinds: ['npm', 'pypi', 'crates'], files, since: target.since, fetchJson });
  assert.equal(result.length, 3);
  assert.ok(result.every(output => output.verified));
  assert.ok(urls.includes('https://registry.npmjs.org/%40o%2Fpkg'));
  const stale = await verifyPackagePublications({ kinds: ['npm'], files, since: '2026-01-03T00:00:00Z', fetchJson });
  assert.equal(stale[0].verified, false);
});

test('registry errors, unknown publishers and dynamic versions do not pass', async () => {
  const files = new Map([['package.json', '{"name":"pkg","version":"1.0.0"}']]);
  const failure = await verifyPackagePublications({
    kinds: ['npm'],
    files,
    since: target.since,
    fetchJson: async () => {
      throw new Error('HTTP 404');
    },
  });
  assert.equal(failure[0].verified, false);
  assert.match(failure[0].detail, /404/);
  const unknown = await verifyPackagePublications({ kinds: ['other-package'], files: new Map(), since: target.since });
  assert.equal(unknown[0].verified, false);
  const dynamic = await verifyPackagePublications({ kinds: ['pypi'], files: new Map([['pyproject.toml', '[project]\nname="pkg"\ndynamic=["version"]\n']]), since: target.since });
  assert.equal(dynamic[0].verified, false);
  const yanked = await verifyPackagePublications({ kinds: ['crates'], files: new Map([['Cargo.toml', '[package]\nname="pkg"\nversion="1.0.0"\n']]), since: target.since, fetchJson: async () => ({ version: { num: '1.0.0', created_at: '2026-01-02T00:00:00Z', yanked: true } }) });
  assert.equal(yanked[0].verified, false);
});

test('monitor allows delayed publications, preserves timeout and cancellation', async () => {
  let elapsed = 60_000;
  let calls = 0;
  const base = Date.parse(target.since);
  const sleep = async ms => {
    elapsed += ms;
  };
  const collect = async () => (++calls === 1 ? { success: false, pending: false, runs: green, outputs: [], errors: ['not published yet'] } : { success: true, runs: green, outputs: [{ verified: true }], errors: [] });
  const options = { repository, target, now: () => base + elapsed, sleep, pollMs: 10, outputGraceMs: 20, timeoutMs: 30 };
  assert.equal((await monitorCiCd({ ...options, collect })).success, true);
  const pending = async () => ({ success: false, pending: true, runs: [], outputs: [], errors: [] });
  assert.equal((await monitorCiCd({ ...options, collect: pending })).success, false);
  assert.equal((await monitorCiCd({ ...options, collect: pending, sleep: async () => ({ interrupted: true }) })).cancelled, true);
});

test('no ancestor relation and unreadable API cannot count as verification', async () => {
  const run = mockApi({ 'repos/o/r/compare/merge...other': { status: 'diverged' } });
  assert.equal(await containsCommit({ repository, ancestor: 'merge', sha: 'other', run }), false);
});

test('end-to-end collection follows scripts and checks registry outputs on the bumped head', async () => {
  const sourceFiles = {
    '.github/workflows/release.yml': 'name: CI\njobs:\n  release:\n    steps:\n      - run: node scripts/release.mjs',
    'scripts/release.mjs': "run('npm publish');",
    'package.json': '{"name":"pkg","version":"1.2.3"}',
  };
  const routes = {
    'repos/o/r/commits/main': { sha: 'bump', commit: { committer: { date: '2026-01-02T00:00:00Z' } } },
    'repos/o/r/compare/merge...bump': { status: 'ahead' },
    'repos/o/r/actions/workflows?per_page=100': [{ workflows: [{ id: 1, name: 'CI', path: '.github/workflows/release.yml', state: 'active' }] }],
    'repos/o/r/actions/workflows/1/runs?per_page=100&page=1': { workflow_runs: [{ ...green[0], id: 1, workflow_id: 1, head_branch: 'main', head_sha: 'merge', created_at: target.since }] },
    'repos/o/r/actions/runs?head_sha=bump&per_page=100': [{ workflow_runs: [] }],
    'repos/o/r/git/trees/bump?recursive=1': { files: Object.keys(sourceFiles), truncated: false },
  };
  for (const [path, content] of Object.entries(sourceFiles)) routes[`repos/o/r/contents/${path}?ref=bump`] = { encoding: 'base64', content: Buffer.from(content).toString('base64') };
  const options = { repository, target, run: mockApi(routes), fetchJson: async () => ({ versions: { '1.2.3': {} }, time: { '1.2.3': '2026-01-02T00:00:00Z' } }) };
  assert.equal((await collectCiCdHealth(options)).success, true);
  assert.equal((await collectCiCdHealth({ ...options, fetchJson: async () => ({}) })).success, false);
  routes['repos/o/r/actions/runs?head_sha=bump&per_page=100'] = [{ workflow_runs: [{ ...green[0], id: 2, workflow_id: 1, event: 'push', head_branch: 'v1.2.3', head_sha: 'bump', created_at: '2026-01-02T00:00:00Z', conclusion: 'failure' }] }];
  const failedTag = await collectCiCdHealth(options);
  assert.equal(failedTag.success, false);
  assert.ok(failedTag.errors.some(error => error.includes('failure')));
});

test('GitHub-managed Pages workflows verify builds without a repository workflow file', async () => {
  const routes = {
    'repos/o/r/commits/main': { sha: 'merge', commit: { committer: { date: target.since } } },
    'repos/o/r/actions/workflows?per_page=100': [{ workflows: [{ id: 1, name: 'pages-build-deployment', path: 'dynamic/pages/pages-build-deployment', state: 'active' }] }],
    'repos/o/r/actions/workflows/1/runs?per_page=100&page=1': { workflow_runs: [{ ...green[0], id: 1, workflow_id: 1, head_branch: 'main', head_sha: 'merge', created_at: target.since }] },
    'repos/o/r/actions/runs?head_sha=merge&per_page=100': [{ workflow_runs: [] }],
    'repos/o/r/git/trees/merge?recursive=1': { files: ['index.html'], truncated: false },
    'repos/o/r/deployments?environment=github-pages&per_page=100': [[]],
    'repos/o/r/pages/builds/latest': { status: 'built', commit: 'merge', created_at: target.since },
  };
  assert.equal((await collectCiCdHealth({ repository, target, run: mockApi(routes) })).success, true);
  routes['repos/o/r/pages/builds/latest'].status = 'errored';
  assert.equal((await collectCiCdHealth({ repository, target, run: mockApi(routes) })).success, false);
});

test('a stale failed run remains pending while post-merge CI starts', async () => {
  let calls = 0;
  const collect = async () => (++calls === 1 ? { success: false, pending: true, runs: [{ ...green[0], conclusion: 'failure' }], outputs: [], errors: ['old failure'] } : { success: true, pending: false, runs: green, outputs: [{ verified: true }], errors: [] });
  let elapsed = 0;
  const result = await monitorCiCd({
    repository,
    target,
    collect,
    now: () => Date.parse(target.since) + 60_000 + elapsed,
    sleep: async ms => {
      elapsed += ms;
    },
    pollMs: 10,
    timeoutMs: 30,
  });
  assert.equal(result.success, true);
  assert.equal(calls, 2);
});

test('completed failures allow the startup window before remediation', async () => {
  let calls = 0;
  let elapsed = 0;
  const result = await monitorCiCd({
    repository,
    target,
    collect: async () => (++calls === 1 ? { success: false, pending: false, runs: [{ ...green[0], conclusion: 'failure' }], outputs: [], errors: ['older workflow failed'] } : { success: true, pending: false, runs: green, outputs: [{ verified: true }], errors: [] }),
    now: () => Date.parse(target.since) + elapsed,
    sleep: async ms => {
      elapsed += ms;
    },
    pollMs: 60_000,
    timeoutMs: 120_000,
  });
  assert.equal(result.success, true);
  assert.equal(calls, 2);
});
