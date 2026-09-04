/**
 * @hive-mind-test-suite default
 *
 * Issue #2198: the incremental change detection of issue #1665 rests on an
 * unstated premise, and CI cancellation breaks it.
 *
 * `scripts/detect-code-changes.mjs` compares `before..after` on a
 * `pull_request synchronize` event, so a docs-only push does not rerun the
 * expensive jobs. That is correct *if the previous head was actually tested*.
 * It often was not: `release.yml` sets `cancel-in-progress: true` on every
 * branch except `main`, so pushing again while a run is in flight cancels it.
 *
 * Push A (code) starts a run. Push B (docs) cancels it, and its own run skips
 * the code jobs because the newest push changed no code. The PR head is green
 * and the code in it has never been through the suite. That happened on this
 * very PR: run 33886267473 was cancelled at `237acd2d` (which extracted
 * `src/agent.version-gates.lib.mjs`) and run 33886365226 at the docs commit
 * after it reported success with `test-suites` and `check-file-line-limits`
 * skipped.
 *
 * The fix keeps #1665's optimisation and checks its premise: the incremental
 * diff is used only when the workflow already has a *successful* run recorded
 * against `GITHUB_BEFORE_SHA`. Otherwise the detector falls back to the full
 * PR diff. Every failure of the lookup itself — no token, an unreachable API,
 * a malformed body — falls back the same way, because the expensive answer is
 * the safe one.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 * @see https://github.com/link-assistant/hive-mind/issues/1665
 */

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts/detect-code-changes.mjs');

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const write = (repoDir, filePath, content) => {
  const full = join(repoDir, filePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};

/** base -> code commit -> docs-only commit, the shape of the incident. */
const fixture = () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'detect-code-changes-2198-'));
  git(repoDir, ['init', '--initial-branch=main']);
  git(repoDir, ['config', 'user.email', 'test@example.com']);
  git(repoDir, ['config', 'user.name', 'Test User']);

  write(repoDir, 'README.md', '# fixture\n');
  git(repoDir, ['add', '.']);
  git(repoDir, ['commit', '-m', 'base']);
  const baseCommit = git(repoDir, ['rev-parse', 'HEAD']);

  git(repoDir, ['checkout', '-b', 'feature']);
  write(repoDir, 'src/feature.mjs', 'export const feature = true;\n');
  git(repoDir, ['add', '.']);
  git(repoDir, ['commit', '-m', 'code change']);
  const codeCommit = git(repoDir, ['rev-parse', 'HEAD']);

  write(repoDir, 'docs/notes.md', 'notes\n');
  git(repoDir, ['add', '.']);
  git(repoDir, ['commit', '-m', 'docs-only change']);
  const docsCommit = git(repoDir, ['rev-parse', 'HEAD']);

  return { baseCommit, codeCommit, docsCommit, repoDir };
};

// Asynchronous on purpose. The stub API below lives in *this* process, so a
// synchronous `execFileSync` would block the event loop that has to answer the
// child's request -- parent waiting on the child, child waiting on the parent.
const run = (repoDir, env) =>
  new Promise((settle, fail) => {
    const merged = { ...process.env, ...env };
    delete merged.GITHUB_OUTPUT;
    // Inherited CI credentials would make the lookup hit the real API.
    for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_API_URL', 'GITHUB_REPOSITORY', 'GITHUB_WORKFLOW_REF']) {
      if (!(key in env)) delete merged[key];
    }
    execFile(process.execPath, [script], { cwd: repoDir, env: merged, encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => (error ? fail(new Error(`${error.message}\n${stderr}`)) : settle(stdout)));
  });

/** A stand-in for `GET /repos/{repo}/actions/workflows/{file}/runs`. */
const stubApi = async ({ totalCount = 0, status = 200, body = null } = {}) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body ?? JSON.stringify({ total_count: totalCount, workflow_runs: [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
};

const CI_ENV = {
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_EVENT_ACTION: 'synchronize',
  GITHUB_TOKEN: 'x-access-token-for-the-stub',
  GITHUB_REPOSITORY: 'link-assistant/hive-mind',
  GITHUB_WORKFLOW_REF: 'link-assistant/hive-mind/.github/workflows/release.yml@refs/pull/2199/merge',
};

// --- the incident: the previous head has no successful run -------------------

{
  const { baseCommit, codeCommit, docsCommit, repoDir } = fixture();
  const api = await stubApi({ totalCount: 0 });
  try {
    const output = await run(repoDir, {
      ...CI_ENV,
      GITHUB_API_URL: api.url,
      GITHUB_BASE_SHA: baseCommit,
      GITHUB_BEFORE_SHA: codeCommit,
      GITHUB_AFTER_SHA: docsCommit,
      GITHUB_HEAD_SHA: docsCommit,
    });

    assert.match(output, /code=true/, 'a PR carrying an untested code commit must run the code jobs, even when the newest push is docs-only');
    assert.match(output, /mjs=true/, 'src/feature.mjs is part of this PR and has not been tested');
    assert.match(output, / {2}src\/feature\.mjs/, 'the full PR diff is what gets reported');
    assert.match(output, /has no successful run/i, 'the reason for widening the comparison is logged');
    assert.ok(
      api.requests.some(url => url.includes('release.yml') && url.includes(codeCommit)),
      `the lookup asks about the previous head of the release workflow; got ${JSON.stringify(api.requests)}`
    );
  } finally {
    await api.close();
    rmSync(repoDir, { recursive: true, force: true });
  }
}

// --- issue #1665 still holds when the premise is true ------------------------

{
  const { baseCommit, codeCommit, docsCommit, repoDir } = fixture();
  const api = await stubApi({ totalCount: 1 });
  try {
    const output = await run(repoDir, {
      ...CI_ENV,
      GITHUB_API_URL: api.url,
      GITHUB_BASE_SHA: baseCommit,
      GITHUB_BEFORE_SHA: codeCommit,
      GITHUB_AFTER_SHA: docsCommit,
      GITHUB_HEAD_SHA: docsCommit,
    });

    assert.match(output, /code=false/, 'a docs-only push on top of an already-tested head must still skip the code jobs (issue #1665)');
    assert.doesNotMatch(output, / {2}src\/feature\.mjs/, 'the incremental comparison is what gets reported');
  } finally {
    await api.close();
    rmSync(repoDir, { recursive: true, force: true });
  }
}

// --- every way the lookup can fail widens the comparison ---------------------

for (const [name, stub, env] of [
  ['the API answers 403', { status: 403, body: '{"message":"Bad credentials"}' }, {}],
  ['the API answers a body that is not JSON', { status: 200, body: '<html>502</html>' }, {}],
  ['no token is available', { totalCount: 1 }, { GITHUB_TOKEN: '' }],
]) {
  const { baseCommit, codeCommit, docsCommit, repoDir } = fixture();
  const api = await stubApi(stub);
  try {
    const output = await run(repoDir, {
      ...CI_ENV,
      GITHUB_API_URL: api.url,
      GITHUB_BASE_SHA: baseCommit,
      GITHUB_BEFORE_SHA: codeCommit,
      GITHUB_AFTER_SHA: docsCommit,
      GITHUB_HEAD_SHA: docsCommit,
      ...env,
    });
    assert.match(output, /code=true/, `${name}: an unusable answer must fall back to the full PR diff, not to trusting the previous head`);
  } finally {
    await api.close();
    rmSync(repoDir, { recursive: true, force: true });
  }
}

// --- outside Actions nothing changes -----------------------------------------

// No `GITHUB_REPOSITORY`/`GITHUB_WORKFLOW_REF` means this is not a workflow
// run, so there is nothing to look up and no network call is attempted. This
// is what keeps tests/test-detect-code-changes-1528.mjs meaningful: it drives
// the same code path it always did.
{
  const { codeCommit, docsCommit, repoDir } = fixture();
  try {
    const output = await run(repoDir, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_ACTION: 'synchronize',
      GITHUB_BEFORE_SHA: codeCommit,
      GITHUB_AFTER_SHA: docsCommit,
      GITHUB_HEAD_SHA: docsCommit,
    });
    assert.match(output, /code=false/, 'without workflow context the detector keeps the plain incremental behaviour');
    assert.doesNotMatch(output, /answered HTTP|Run lookup/, 'and attempts no network call at all');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

// --- widening must never narrow ----------------------------------------------

// The first draft of this fix returned `null` for an unverified head, letting
// `getChangedFiles` fall through to its full-PR branch. Without a base SHA that
// branch falls through again, to `HEAD^..HEAD` -- one commit, *narrower* than
// the `before..after` range it replaced. A fix for a false negative that
// manufactures a worse one. Here the range spans two commits and only the
// second is docs; the earlier code commit must still be reported.
{
  const { baseCommit, codeCommit, docsCommit, repoDir } = fixture();
  const api = await stubApi({ totalCount: 0 });
  try {
    const output = await run(repoDir, {
      ...CI_ENV,
      GITHUB_API_URL: api.url,
      GITHUB_BEFORE_SHA: baseCommit,
      GITHUB_AFTER_SHA: docsCommit,
      GITHUB_HEAD_SHA: docsCommit,
    });
    assert.match(output, /code=true/, 'with no base SHA to widen to, the incremental range is kept -- never replaced by something narrower');
    assert.match(output, / {2}src\/feature\.mjs/, `the code commit ${codeCommit.slice(0, 7)} is inside the range and must be reported`);
  } finally {
    await api.close();
    rmSync(repoDir, { recursive: true, force: true });
  }
}

// --- the workflow passes the context the lookup needs ------------------------

const releaseWorkflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
const detectJob = releaseWorkflow.match(/ {2}detect-changes:([\s\S]*?)\n {2}[a-z]/)?.[1];
assert.ok(detectJob, 'release.yml still has a detect-changes job');
assert.match(detectJob, /GITHUB_TOKEN:/, 'detect-changes passes a token so it can ask whether the previous head was tested');
assert.match(detectJob, /GITHUB_WORKFLOW_REF:/, 'detect-changes passes the workflow ref so the lookup targets its own workflow');

console.log('detect-code-changes-untested-head-2198.test.mjs: all assertions passed');
