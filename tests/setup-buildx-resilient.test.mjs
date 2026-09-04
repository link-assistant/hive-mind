/**
 * @hive-mind-test-suite default
 *
 * Issue #2198: every Docker job in release.yml booted buildx through a bare
 * docker/setup-buildx-action, so a transient registry-1.docker.io outage
 * failed the publish -- eight times over, once per Docker job. The composite
 * action ported from the pipeline template pre-pulls the pinned BuildKit image
 * with backoff and falls back to a pull-through mirror.
 *
 * These tests drive the action's real pre-pull script (extracted from
 * action.yml, so it cannot drift from a copy) against a mock `docker` on PATH.
 * No network, no Docker daemon.
 *
 * Ported from
 * https://github.com/link-foundation/js-ai-driven-development-pipeline-template
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from the test's own location: the suite runner may start the
// process from anywhere.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const readRepoFile = relative => readFileSync(join(repoRoot, relative), 'utf8');

const action = readRepoFile('.github/actions/setup-buildx-resilient/action.yml');

// Extract the first `run: |` block verbatim from the action so the test drives
// the real pre-pull script (not a copy that can drift out of sync). The block
// starts after the first `run: |` line and ends at the next step (`    - name:`
// at 4-space indent). The body is dedented by its own indentation.
function extractPrepullScript(yaml) {
  const lines = yaml.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex(line => /^\s*run: \|\s*$/.test(line));
  if (start === -1) {
    throw new Error("could not find 'run: |' in action.yml");
  }

  const body = [];
  let indent = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,4}- name:/.test(line)) {
      break;
    }
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (indent === null) {
      indent = line.match(/^\s*/)[0].length;
    }
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

// A mock `docker` CLI placed on PATH. CANONICAL_OK / MIRROR_OK env fixtures
// decide whether each source serves pulls. It records calls/pulls/tags so the
// test can assert exactly which registry the script reached for.
const MOCK_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$DOCKER_CALLS"
case "$1" in
  pull)
    ref="$2"
    case "$ref" in
      mirror.gcr.io/*)
        [ "\${MIRROR_OK:-0}" = "1" ] && { echo "$ref" >> "$DOCKER_PULLED"; exit 0; }
        echo 'Error response from daemon: Get "https://mirror.gcr.io/v2/": timeout' >&2
        exit 1 ;;
      *)
        [ "\${CANONICAL_OK:-0}" = "1" ] && { echo "$ref" >> "$DOCKER_PULLED"; exit 0; }
        echo 'Error response from daemon: Get "https://registry-1.docker.io/v2/": timeout' >&2
        exit 1 ;;
    esac ;;
  tag)
    echo "tag $2 $3" >> "$DOCKER_TAGGED"; exit 0 ;;
  *) exit 0 ;;
esac
`;

function runCase({ canonicalOk, mirrorOk }) {
  const work = mkdtempSync(join(tmpdir(), 'buildx-resilient-'));
  const bin = join(work, 'bin');
  execFileSync('mkdir', ['-p', bin]);

  const scriptPath = join(work, 'prepull.sh');
  writeFileSync(scriptPath, extractPrepullScript(action));

  const dockerPath = join(bin, 'docker');
  writeFileSync(dockerPath, MOCK_DOCKER);
  chmodSync(dockerPath, 0o755);

  const calls = join(work, 'calls');
  const pulled = join(work, 'pulled');
  const tagged = join(work, 'tagged');
  for (const file of [calls, pulled, tagged]) {
    writeFileSync(file, '');
  }

  let status = 0;
  let output;
  try {
    output = execFileSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BUILDKIT_IMAGE: 'moby/buildkit:buildx-stable-1',
        REGISTRY_MIRROR: 'mirror.gcr.io',
        VERBOSE: 'false',
        PREPULL_ATTEMPTS: '2',
        PREPULL_DELAY: '1',
        CANONICAL_OK: canonicalOk ? '1' : '0',
        MIRROR_OK: mirrorOk ? '1' : '0',
        DOCKER_CALLS: calls,
        DOCKER_PULLED: pulled,
        DOCKER_TAGGED: tagged,
      },
    });
  } catch (error) {
    status = error.status ?? 1;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  return {
    status,
    output,
    calls: readFileSync(calls, 'utf8'),
    pulled: readFileSync(pulled, 'utf8'),
    tagged: readFileSync(tagged, 'utf8'),
  };
}

// The two constants the fixture is configured with, named once so the
// assertions below compare against the same values `runCase` passes in.
const REGISTRY_MIRROR = 'mirror.gcr.io';
const BUILDKIT_IMAGE = 'moby/buildkit:buildx-stable-1';

/**
 * The registry host of a Docker image reference, or '' for an implicit Docker
 * Hub reference: `moby/buildkit:tag` -> '', `mirror.gcr.io/moby/buildkit:tag`
 * -> 'mirror.gcr.io'. The first segment is a registry only if it looks like a
 * host (contains a dot or a port) or if segments follow it on both sides.
 */
const registryOf = ref => {
  const [head, ...rest] = ref.split('/');
  return rest.length >= 2 || head.includes('.') || head.includes(':') ? head : '';
};

/** One `{ command, args }` per line the mock `docker` recorded. */
const dockerCalls = log =>
  log
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      const [command, ...args] = line.trim().split(/\s+/);
      return { command, args };
    });

/** The image references a recorded log pulled from one specific registry. */
const pullsFromRegistry = (log, registry) =>
  dockerCalls(log)
    .filter(call => call.command === 'pull')
    .map(call => call.args[0] ?? '')
    .filter(ref => registryOf(ref) === registry);

/** Every image reference the mock actually served, one per line. */
const pulledRefs = log => log.split('\n').filter(line => line.trim() !== '');

// These read the recorded log as structured calls rather than searching it as
// one string. That is the more exact assertion -- "the mirror was contacted"
// should mean a pull whose *registry* is the mirror, not the mirror's name
// appearing anywhere, in any argument, in any order -- and it also retires
// CodeQL alerts 256 and 257, which read `calls.includes('mirror.gcr.io')` as
// incomplete URL sanitization. The alert was a false positive about the
// security property (this is a test log, not an access decision) and correct
// about the code: a substring search was never what these lines meant.

describe('setup-buildx-resilient pre-pull script', () => {
  it('caches the canonical image and never touches the mirror when Docker Hub is healthy', () => {
    const result = runCase({ canonicalOk: true, mirrorOk: false });

    assert.equal(result.status, 0, result.output);
    assert.ok(pulledRefs(result.pulled).includes(BUILDKIT_IMAGE), 'the canonical image is pulled');
    assert.deepEqual(pullsFromRegistry(result.calls, REGISTRY_MIRROR), [], 'the mirror is not contacted when the canonical registry works');
    assert.equal(result.tagged.trim(), '', 'nothing is re-tagged on the happy path');
  });

  it('recovers via the mirror and re-tags to canonical when Docker Hub is down', () => {
    const result = runCase({ canonicalOk: false, mirrorOk: true });

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(pullsFromRegistry(result.calls, REGISTRY_MIRROR), [`${REGISTRY_MIRROR}/${BUILDKIT_IMAGE}`], 'the mirror is asked for exactly the pinned image');
    assert.ok(pulledRefs(result.pulled).includes(`${REGISTRY_MIRROR}/${BUILDKIT_IMAGE}`), 'the mirror serves the image');
    assert.deepEqual(
      dockerCalls(result.tagged).filter(call => call.command === 'tag'),
      [{ command: 'tag', args: [`${REGISTRY_MIRROR}/${BUILDKIT_IMAGE}`, BUILDKIT_IMAGE] }],
      'the mirrored image is re-tagged to its canonical reference so the buildx boot finds it locally'
    );
  });

  it('falls through non-fatally when both the registry and the mirror are down', () => {
    const result = runCase({ canonicalOk: false, mirrorOk: false });

    // Non-fatal by design: the step still exits 0 so the buildx boot can try
    // its own pull, preserving the previous worst-case behaviour. A pre-pull
    // that could fail the job would be a new failure mode, not a fix.
    assert.equal(result.status, 0, result.output);
    // Twice, not once: `runCase` sets PREPULL_ATTEMPTS=2, and a mirror that is
    // also down gets the same retry budget as the canonical registry. The
    // substring check this replaced could not see the difference between one
    // attempt and two, so the retry budget was asserted by nobody.
    assert.deepEqual(pullsFromRegistry(result.calls, REGISTRY_MIRROR), [`${REGISTRY_MIRROR}/${BUILDKIT_IMAGE}`, `${REGISTRY_MIRROR}/${BUILDKIT_IMAGE}`], 'the mirror was attempted, once per configured pre-pull attempt');
    assert.ok(result.output.includes('could not pre-pull'), 'the warning names the situation');
  });
});

describe('setup-buildx-resilient action.yml', () => {
  it('declares the mirror fallback and pins the boot driver image', () => {
    assert.ok(action.includes('registry-mirror:'), 'the mirror is an input');
    assert.ok(action.includes("default: 'mirror.gcr.io'"), 'the mirror defaults to a pull-through cache');
    assert.ok(action.includes('driver-opts: image=${{ inputs.buildkit-image }}'), 'the boot uses the image the pre-pull cached');
  });

  it('supports verbose tracing, off by default, and honours RUNNER_DEBUG', () => {
    assert.ok(action.includes('set -x'), 'tracing is available');
    assert.ok(action.includes('RUNNER_DEBUG'), 'step debug logging turns tracing on');
    assert.match(action, /verbose:[\s\S]*?default: 'false'/, 'tracing is off by default');
  });
});

// Every Docker job must go through the wrapper: one bare
// docker/setup-buildx-action left behind keeps the failure mode alive in that
// job, and this file would still pass without this check.
describe('release.yml', () => {
  it('boots buildx through the wrapper everywhere', () => {
    const workflow = readRepoFile('.github/workflows/release.yml');

    assert.ok(!workflow.includes('uses: docker/setup-buildx-action'), 'no job boots buildx directly');
    assert.ok(workflow.includes('uses: ./.github/actions/setup-buildx-resilient'), 'the wrapper is used');
  });

  it('checks out before referencing the local composite action', () => {
    const workflow = readRepoFile('.github/workflows/release.yml').replaceAll('\r\n', '\n');

    // A local action is read from the workspace, so every job that uses one
    // must have run actions/checkout first. The four manifest-merge jobs used
    // to check out *after* their buildx step.
    for (const job of workflow.split(/^ {2}(?=[A-Za-z0-9_-]+:$)/m)) {
      const buildx = job.indexOf('uses: ./.github/actions/setup-buildx-resilient');
      if (buildx === -1) {
        continue;
      }
      const checkout = job.indexOf('uses: actions/checkout@');
      const name = job.slice(0, job.indexOf(':'));
      assert.ok(checkout !== -1 && checkout < buildx, `job ${name} checks out before it uses the local composite action`);
    }
  });
});
