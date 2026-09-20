/**
 * @hive-mind-test-suite default
 *
 * Issue #2221: on the default branch a pipeline whose job is to publish must
 * prove it can publish before it spends anything. `release.yml` first touched
 * DOCKERHUB_TOKEN in a `docker/login-action` step that runs after npm has
 * already published, so an expired token was discovered at the end of a run
 * whose whole purpose was the release.
 *
 * These tests drive the probes and the preflight decision against a fake
 * registry, so the state machine is exercised offline -- including the two
 * cases that make the cheap version of this check useless:
 *
 *   - a token endpoint answering HTTP 200 is not proof of write access
 *     (ghcr.io hands a push-scoped token to anybody; docker.io silently
 *     narrows an anonymous push request to pull), and
 *   - HTTP 429 is not evidence that an image is missing.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2221
 * @see https://github.com/link-foundation/box/issues/117
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANIFEST_ACCEPT, parseImageReference, probeAnonymousPull, probeOidcToken, probeRegistryWrite, registryEndpoints } from '../scripts/registry-probe.lib.mjs';
import { buildTargets, renderAnnotations, renderSummary, resolveMode, runPreflight, severityOf } from '../scripts/preflight-credentials.lib.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const readRepoFile = relative => readFileSync(join(repoRoot, relative), 'utf8');

/** A minimal Response stand-in: everything the probes read, nothing else. */
const response = (status, body = '', headers = {}) => ({
  status,
  headers: { get: name => headers[name.toLowerCase()] ?? headers[name] ?? null },
  text: async () => body,
});

/**
 * A fake registry. Routes are matched in order against `METHOD url`; the first
 * match answers. Every call is recorded so a test can assert what was actually
 * asked for -- which request was made is the whole point of these probes.
 */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, headers: init.headers || {} });
    for (const [pattern, answer] of routes) {
      if (`${method} ${url}`.includes(pattern)) return typeof answer === 'function' ? answer() : answer;
    }
    throw new Error(`fake registry has no route for ${method} ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const DOCKER_TOKEN_URL = 'https://auth.docker.io/token';
const DOCKER_API = 'https://registry-1.docker.io';
const GHCR_TOKEN_URL = 'https://ghcr.io/token';

describe('parseImageReference', () => {
  it('applies the same defaults docker pull does', () => {
    assert.deepEqual(parseImageReference('konard/hive-mind'), { registry: 'docker.io', repository: 'konard/hive-mind', tag: 'latest' });
    assert.deepEqual(parseImageReference('alpine:3.20'), { registry: 'docker.io', repository: 'library/alpine', tag: '3.20' });
    assert.deepEqual(parseImageReference('ghcr.io/link-assistant/hive-mind:2.20.0'), { registry: 'ghcr.io', repository: 'link-assistant/hive-mind', tag: '2.20.0' });
    assert.deepEqual(parseImageReference('docker.io/konard/hive-mind@sha256:abc'), { registry: 'docker.io', repository: 'konard/hive-mind', tag: 'sha256:abc' });
  });

  it('knows only the registries it can actually reach', () => {
    assert.ok(registryEndpoints('ghcr.io'));
    assert.ok(registryEndpoints('docker.io'));
    assert.equal(registryEndpoints('quay.io'), null, 'an unknown registry is not guessed at');
  });
});

describe('probeRegistryWrite', () => {
  it('reports a missing credential without touching the network', async () => {
    const fetchImpl = fakeFetch([]);
    const result = await probeRegistryWrite({ registry: 'docker.io', repository: 'konard/hive-mind', username: '', secret: '', fetchImpl });

    assert.equal(result.state, 'missing-credentials');
    assert.deepEqual(fetchImpl.calls, [], 'no request is made when there is nothing to authenticate with');
  });

  it('proves write access by opening a blob upload session and cancelling it', async () => {
    const fetchImpl = fakeFetch([
      [`GET ${DOCKER_TOKEN_URL}`, response(200, JSON.stringify({ token: 'push-token' }))],
      [`POST ${DOCKER_API}/v2/konard/hive-mind/blobs/uploads/`, response(202, '', { location: '/v2/konard/hive-mind/blobs/uploads/session-1' })],
      ['DELETE ', response(204)],
    ]);

    const result = await probeRegistryWrite({ registry: 'docker.io', repository: 'konard/hive-mind', username: 'konard', secret: 'dckr_pat_valid', fetchImpl });

    assert.equal(result.state, 'ok');
    assert.deepEqual(
      fetchImpl.calls.map(call => `${call.method} ${call.url}`),
      [`${DOCKER_TOKEN_URL}?service=registry.docker.io&scope=repository:konard/hive-mind:pull,push`, `${DOCKER_API}/v2/konard/hive-mind/blobs/uploads/`, `${DOCKER_API}/v2/konard/hive-mind/blobs/uploads/session-1`].map((url, index) => `${['GET', 'POST', 'DELETE'][index]} ${url}`),
      'the probe asks for a push scope, opens an upload session, and hands it back'
    );
    assert.ok(!('body' in fetchImpl.calls[1]), 'no bytes are uploaded, so nothing is stored');
  });

  it('does not read a 200 from the token endpoint as write access', async () => {
    // The measured ghcr.io behaviour: any credential gets HTTP 200 and a
    // "push"-scoped token for any repository. The push is what answers.
    const fetchImpl = fakeFetch([
      [`GET ${GHCR_TOKEN_URL}`, response(200, JSON.stringify({ token: 'meaningless' }))],
      ['POST https://ghcr.io/v2/', response(403, '{"errors":[{"code":"DENIED","message":"permission_denied: write_package"}]}')],
    ]);

    const result = await probeRegistryWrite({ registry: 'ghcr.io', repository: 'link-assistant/hive-mind', username: 'ci', secret: 'ghp_read_only', fetchImpl });

    assert.equal(result.state, 'insufficient-scope', 'a token the registry hands out freely is not evidence of anything');
    assert.match(result.detail, /HTTP 403/);
  });

  it('reports a rejected credential in the registry’s own words', async () => {
    const fetchImpl = fakeFetch([[`GET ${DOCKER_TOKEN_URL}`, response(401, '{"details":"incorrect username or password"}')]]);
    const result = await probeRegistryWrite({ registry: 'docker.io', repository: 'konard/hive-mind', username: 'konard', secret: 'dckr_pat_expired', fetchImpl });

    assert.equal(result.state, 'invalid-credentials');
    assert.match(result.detail, /incorrect username or password/, 'the detail carries the registry answer, so the fix is obvious');
    assert.ok(!result.detail.includes('dckr_pat_expired'), 'the credential is never echoed');
  });

  it('reports unknown rather than a failure when the registry does not answer', async () => {
    const failing = async () => {
      throw new Error('getaddrinfo EAI_AGAIN auth.docker.io');
    };
    const result = await probeRegistryWrite({ registry: 'docker.io', repository: 'konard/hive-mind', username: 'konard', secret: 'token', fetchImpl: failing });

    assert.equal(result.state, 'unknown', 'an outage is not proof that a credential is broken');
    assert.match(result.detail, /EAI_AGAIN/);
  });
});

describe('probeAnonymousPull', () => {
  const pullRoutes = manifest => [
    [`GET ${DOCKER_TOKEN_URL}`, response(200, JSON.stringify({ token: 'anon' }))],
    [`GET ${DOCKER_API}/v2/konard/hive-mind/manifests/2.20.0`, manifest],
  ];

  it('sends no credentials and accepts multi-arch indexes', async () => {
    const fetchImpl = fakeFetch(pullRoutes(response(200, '{"manifests":[]}')));
    const result = await probeAnonymousPull({ reference: 'docker.io/konard/hive-mind:2.20.0', fetchImpl });

    assert.equal(result.state, 'published');
    assert.equal(fetchImpl.calls[0].headers.Authorization, undefined, 'the token request is anonymous: it measures the consumer view, not the publisher view');
    assert.ok(MANIFEST_ACCEPT.includes('application/vnd.oci.image.index.v1+json'));
    assert.equal(fetchImpl.calls[1].headers.Accept, MANIFEST_ACCEPT, 'an index must not read as missing because it was not asked for');
  });

  it('separates missing from private from rate limited', async () => {
    const missing = await probeAnonymousPull({ reference: 'docker.io/konard/hive-mind:2.20.0', fetchImpl: fakeFetch(pullRoutes(response(404, '{"errors":[{"code":"MANIFEST_UNKNOWN"}]}'))) });
    assert.equal(missing.state, 'missing');

    const privateByToken = await probeAnonymousPull({ reference: 'ghcr.io/link-assistant/hive-mind:2.20.0', fetchImpl: fakeFetch([[`GET ${GHCR_TOKEN_URL}`, response(401)]]) });
    assert.equal(privateByToken.state, 'private', 'a package that is private on first push is not a missing package');

    // Measured 2026-09-06 (dev/log/issues/2221/live-probe.log): Docker Hub
    // answers 401 here for a name that does not exist, so the state names what
    // was established -- not publicly pullable -- instead of picking one.
    const notPullable = await probeAnonymousPull({ reference: 'docker.io/konard/hive-mind:2.20.0', fetchImpl: fakeFetch(pullRoutes(response(401, 'unauthorized'))) });
    assert.equal(notPullable.state, 'private');
    assert.match(notPullable.detail, /also the answer for a repository that does not exist/);

    const rateLimited = await probeAnonymousPull({ reference: 'docker.io/konard/hive-mind:2.20.0', fetchImpl: fakeFetch(pullRoutes(response(429, 'toomanyrequests'))) });
    assert.equal(rateLimited.state, 'unknown', 'rate limiting is not evidence that an image is missing');
    assert.match(rateLimited.detail, /not evidence/);
  });
});

describe('probeOidcToken', () => {
  it('names the missing permission rather than blaming the token', async () => {
    const result = await probeOidcToken({ env: {}, fetchImpl: fakeFetch([]) });

    assert.equal(result.state, 'missing-permission');
    assert.match(result.detail, /id-token: write/);
  });

  it('confirms the runner can mint a token without printing it', async () => {
    const fetchImpl = fakeFetch([['GET https://runner.example/idtoken', response(200, JSON.stringify({ value: 'eyJ-secret-token' }))]]);
    const result = await probeOidcToken({
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://runner.example/idtoken?api-version=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token' },
      fetchImpl,
    });

    assert.equal(result.state, 'ok');
    assert.ok(!result.detail.includes('eyJ-secret-token'), 'the ID token is a credential and is never reported');
  });
});

describe('preflight decision', () => {
  const probes = states => ({
    probeRegistryWrite: async ({ repository }) => ({ state: states[repository] || 'ok', detail: `fake ${repository}` }),
    probeAnonymousPull: async ({ reference }) => ({ state: states[reference] || 'published', detail: `fake ${reference}` }),
    probeOidcToken: async () => ({ state: states.oidc || 'ok', detail: 'fake oidc' }),
  });

  it('is a release on a push to the default branch and a report everywhere else', () => {
    assert.equal(resolveMode({ env: { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } }), 'release');
    assert.equal(resolveMode({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch' } }), 'release');
    assert.equal(resolveMode({ env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/2222/merge' } }), 'report');
    assert.equal(resolveMode({ env: { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/issue-2221' } }), 'report', 'a push to a branch publishes nothing');
    assert.equal(resolveMode({ argv: ['--mode', 'report'], env: { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } }), 'report', 'an explicit mode wins');
    assert.throws(() => resolveMode({ argv: ['--mode=audit'] }), /unknown --mode/);
  });

  it('derives the targets this repository actually publishes to', () => {
    const targets = buildTargets({ env: { DOCKERHUB_USERNAME: 'konard', DOCKERHUB_TOKEN: 'secret', PREFLIGHT_PULL_TARGETS: 'docker.io/konard/hive-mind:latest' } });

    assert.deepEqual(
      targets.map(target => target.id),
      ['push:docker.io/konard/hive-mind', 'push:docker.io/konard/hive-mind-dind', 'pull:docker.io/konard/hive-mind:latest', 'oidc:npm'],
      'both published images, the reachability check and npm trusted publishing'
    );
    assert.equal(targets[0].secret, 'secret');
  });

  it('probes every target instead of stopping at the first failure', async () => {
    const targets = buildTargets({ env: { DOCKERHUB_USERNAME: 'konard', DOCKERHUB_TOKEN: 'expired', PREFLIGHT_NPM_OIDC: 'false' } });
    const result = await runPreflight({ mode: 'release', targets, probes: probes({ 'konard/hive-mind': 'invalid-credentials', 'konard/hive-mind-dind': 'insufficient-scope' }) });

    assert.equal(result.rows.length, 2, 'both credentials are reported in one run, not one per run');
    assert.equal(result.failures, 2);
    assert.equal(result.ok, false);
  });

  it('never blocks a pull request, and says what it found anyway', async () => {
    const targets = buildTargets({ env: { PREFLIGHT_NPM_OIDC: 'false' } });
    const result = await runPreflight({ mode: 'report', targets, probes: probes({ 'konard/hive-mind': 'missing-credentials', 'konard/hive-mind-dind': 'invalid-credentials' }) });

    assert.equal(result.failures, 0, 'a fork PR has no secrets; failing here would only block contributors');
    assert.equal(result.warnings, 2);
    assert.deepEqual(
      renderAnnotations(result).map(line => line.split('::')[1]),
      ['warning title=Release preflight: push docker.io/konard/hive-mind', 'warning title=Release preflight: push docker.io/konard/hive-mind-dind'],
      'the finding is still annotated on the run'
    );
  });

  it('treats an unreachable registry as unknown, not as a broken credential', async () => {
    const targets = buildTargets({ env: { DOCKERHUB_USERNAME: 'konard', DOCKERHUB_TOKEN: 'valid', PREFLIGHT_NPM_OIDC: 'false' } });
    const result = await runPreflight({ mode: 'release', targets, probes: probes({ 'konard/hive-mind': 'unknown', 'konard/hive-mind-dind': 'unknown' }) });

    assert.equal(result.failures, 0, 'an outage must not invent a new way for a release to fail');
    assert.equal(result.verified, 0);
    assert.match(renderSummary(result), /Nothing was verified\./, 'a run that established nothing must not read as a pass');
  });

  it('never blocks the release on reachability of an image that does not exist yet', () => {
    assert.equal(severityOf({ kind: 'pull', state: 'missing' }, 'release'), 'warning');
    assert.equal(severityOf({ kind: 'push', state: 'missing-credentials' }, 'release'), 'error');
    assert.equal(severityOf({ kind: 'push', state: 'missing-credentials' }, 'report'), 'warning');
    assert.equal(severityOf({ kind: 'oidc', state: 'missing-permission' }, 'release'), 'error');
  });
});

describe('preflight-credentials.mjs', () => {
  // End to end through the real CLI, still offline: a missing credential is
  // answered before any request is made, so these runs touch no network.
  const runCli = mode => {
    const work = mkdtempSync(join(tmpdir(), 'preflight-2221-'));
    const outputFile = join(work, 'output');
    const summaryFile = join(work, 'summary');
    writeFileSync(outputFile, '');
    writeFileSync(summaryFile, '');

    let status = 0;
    let stdout;
    try {
      stdout = execFileSync('node', [join(repoRoot, 'scripts/preflight-credentials.mjs'), '--mode', mode], {
        encoding: 'utf8',
        env: { ...process.env, DOCKERHUB_USERNAME: '', DOCKERHUB_TOKEN: '', PREFLIGHT_PULL_TARGETS: '', PREFLIGHT_NPM_OIDC: 'false', GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile },
      });
    } catch (error) {
      status = error.status ?? 1;
      stdout = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }

    return { status, stdout, outputs: readFileSync(outputFile, 'utf8'), summary: readFileSync(summaryFile, 'utf8') };
  };

  it('stops a release that cannot publish', () => {
    const result = runCli('release');

    assert.equal(result.status, 1, 'the run stops before it builds anything');
    assert.ok(result.outputs.includes('ok=false'), result.outputs);
    assert.ok(result.outputs.includes('failures=2'), result.outputs);
    assert.match(result.stdout, /::error title=Release preflight/);
    assert.match(result.summary, /Release preflight/);
  });

  it('reports the same finding without failing a pull request', () => {
    const result = runCli('report');

    assert.equal(result.status, 0);
    assert.ok(result.outputs.includes('ok=true'), result.outputs);
    assert.ok(result.outputs.includes('warnings=2'), result.outputs);
    assert.match(result.stdout, /::warning title=Release preflight/);
  });
});

describe('release.yml', () => {
  const workflow = readRepoFile('.github/workflows/release.yml').replaceAll('\r\n', '\n');
  // The steps live in a called workflow because release.yml is line-limited
  // (scripts/check-file-line-limits.sh); both halves are checked here so the
  // split cannot hide a missing piece.
  const preflight = readRepoFile('.github/workflows/release-preflight.yml').replaceAll('\r\n', '\n');
  const jobOf = name => workflow.split(/^ {2}(?=[A-Za-z0-9_-]+:$)/m).find(block => block.startsWith(`${name}:`)) ?? '';

  it('runs the preflight before anything is published', () => {
    const job = jobOf('release-preflight');

    assert.ok(job, 'release.yml declares a release-preflight job');
    assert.match(job, /uses: \.\/\.github\/workflows\/release-preflight\.yml/, 'it calls the preflight workflow');
    assert.match(job, /id-token: write/, 'the caller grants the OIDC permission the probe checks for -- a called workflow can only narrow it');
    assert.match(job, /!cancelled\(\)/, 'the job honours concurrency cancellation');
    assert.match(job, /DOCKERHUB_TOKEN: \$\{\{ secrets\.DOCKERHUB_TOKEN \}\}/, 'the registry credential is passed by name, not by `secrets: inherit`');

    assert.match(preflight, /on:\n {2}workflow_call:/, 'the preflight workflow is callable');
    assert.match(preflight, /node scripts\/preflight-credentials\.mjs/, 'it runs the probe');
    assert.match(preflight, /timeout-minutes:/, 'every job declares a timeout');
  });

  it('gates every publishing job on it', () => {
    for (const name of ['release', 'instant-release']) {
      const job = jobOf(name);
      assert.match(job, /needs: \[[^\]]*release-preflight/, `${name} needs the preflight`);
      assert.match(job, /needs\.release-preflight\.result == 'success'/, `${name} does not start unless the preflight passed`);
    }
  });

  it('lets the preflight report on pull requests instead of blocking them', () => {
    assert.match(preflight, /PREFLIGHT_MODE: \$\{\{ .*'release' \|\| 'report' \}\}/, 'a push to main and a manual dispatch fail fast; everything else reports');
    assert.match(preflight, /--mode "\$PREFLIGHT_MODE"/, 'the mode reaches the script through the environment, not through the run line');
  });
});
