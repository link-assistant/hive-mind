#!/usr/bin/env node

/**
 * Regression coverage for issue #2208 — task provenance must name the Formal AI
 * release that actually served the requests.
 *
 * `prepareFormalAiRuntime` read `formal-ai --version` from the local executable,
 * checked *that* against the supported floor and logged it as "the Formal AI
 * version". When `HIVE_MIND_FORMAL_AI_BASE_URL` points at a sidecar container —
 * which is the normal case for an isolated task — the local wrapper and the
 * serving backend are two different builds, so every record named a binary that
 * never saw the request, and an unsupported or memory-incompatible server was
 * never noticed at all.
 *
 * The local wrapper still has its own compatibility requirement; it keeps its
 * own name (`formalAiWrapperVersion`) and its own check.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2208
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertSupportedFormalAiBackend, buildFormalAiSidecarProvenanceEnv, prepareFormalAiRuntime, probeFormalAiBackend, readFormalAiSidecarProvenance, resetFormalAiRuntimeCache, FORMAL_AI_HEALTH_PATH, FORMAL_AI_SIDECAR_PROVENANCE_ENV } from '../src/formal-ai-runtime.lib.mjs';
import { buildFormalAiTaskEnv } from '../src/formal-ai-isolation.lib.mjs';
import { FORMAL_AI_MINIMUM_VERSION } from '../src/formal-ai-version.lib.mjs';

const WRAPPER_VERSION = FORMAL_AI_MINIMUM_VERSION;

/** An endpoint whose answer the test controls, request by request. */
const withBackend = async (handler, body) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    handler(request, response, requests.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await body({ baseUrl, requests });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};

const answerJson = payload => (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(typeof payload === 'function' ? payload(request) : payload));
};

/**
 * Drive `prepareFormalAiRuntime` against a real endpoint with everything that
 * is not under test stubbed out.
 */
const prepareAgainst = async ({ baseUrl, wrapperVersion = WRAPPER_VERSION, env = {}, logs = [], workdir = null }) => {
  const home = await mkdtemp(join(tmpdir(), 'hive-2208-'));
  try {
    return await prepareFormalAiRuntime({
      tool: 'agent',
      workdir: workdir || home,
      env: { HIVE_MIND_FORMAL_AI_BASE_URL: baseUrl, HIVE_MIND_FORMAL_AI_HOME_ROOT: home, ...env },
      log: async message => void logs.push(message),
      deps: {
        readVersionImpl: async () => wrapperVersion,
        mkdtempImpl: async () => home,
        loadRegistryImpl: async () => [{ id: 'agent', global_configs: [] }],
        seedImpl: async () => [],
        configureImpl: async () => {},
      },
    });
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
};

// ---------------------------------------------------------------------------
// The reported version is the server's, and the wrapper keeps its own name.
// ---------------------------------------------------------------------------

test('the serving backend, not the local wrapper, is what provenance records', async () => {
  await withBackend(answerJson({ version: '0.346.0', memory: { compatible: true, schema_version: 3 } }), async ({ baseUrl, requests }) => {
    resetFormalAiRuntimeCache();
    const logs = [];
    const runtime = await prepareAgainst({ baseUrl, wrapperVersion: WRAPPER_VERSION, logs });
    try {
      assert.equal(runtime.formalAiVersion, '0.346.0', 'the release that answers the requests');
      assert.equal(runtime.formalAiWrapperVersion, WRAPPER_VERSION, 'the local executable, under its own name');
      assert.equal(runtime.backend.baseUrl, baseUrl);
      assert.equal(runtime.backend.memory.schema_version, 3);
      assert.equal(requests.length, 1, 'the endpoint is asked exactly once per preparation');
      assert.equal(requests[0].url, FORMAL_AI_HEALTH_PATH);
      // Ordinary logs must let an operator tell the two apart after the fact.
      assert.ok(
        logs.some(line => line.includes('local wrapper') && line.includes(WRAPPER_VERSION)),
        `a wrapper line is logged: ${JSON.stringify(logs)}`
      );
      assert.ok(
        logs.some(line => line.includes('serving backend') && line.includes('0.346.0') && line.includes(baseUrl)),
        `a serving-backend line is logged: ${JSON.stringify(logs)}`
      );
    } finally {
      await runtime.stop();
      resetFormalAiRuntimeCache();
    }
  });
});

test('a fresh local wrapper does not excuse an unsupported server', async () => {
  await withBackend(answerJson({ version: '0.100.0', memory: { compatible: true } }), async ({ baseUrl }) => {
    resetFormalAiRuntimeCache();
    await assert.rejects(prepareAgainst({ baseUrl, wrapperVersion: '9.9.9' }), new RegExp(`serves Formal AI 0\\.100\\.0.*requires >= ${FORMAL_AI_MINIMUM_VERSION.replace(/\./g, '\\.')}`, 's'));
    resetFormalAiRuntimeCache();
  });
});

test('a server that cannot read the persisted memory is refused', async () => {
  await withBackend(answerJson({ version: '0.346.0', memory: { compatible: false, migration_state: 'ahead' } }), async ({ baseUrl }) => {
    resetFormalAiRuntimeCache();
    await assert.rejects(prepareAgainst({ baseUrl }), /incompatible persisted memory \(migration_state=ahead\)/);
    resetFormalAiRuntimeCache();
  });
});

// ---------------------------------------------------------------------------
// Malformed, silent and unauthenticated endpoints.
// ---------------------------------------------------------------------------

test('a malformed health body is reported as such instead of being guessed at', async () => {
  await withBackend(
    (request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<html>upstream proxy</html>');
    },
    async ({ baseUrl }) => {
      resetFormalAiRuntimeCache();
      await assert.rejects(prepareAgainst({ baseUrl }), /answered \/health with something other than JSON/);
      resetFormalAiRuntimeCache();
    }
  );
});

test('a health answer without a version is not silently accepted', async () => {
  await withBackend(answerJson({ status: 'ok', memory: { compatible: true } }), async ({ baseUrl }) => {
    resetFormalAiRuntimeCache();
    await assert.rejects(prepareAgainst({ baseUrl }), /without a version/);
    resetFormalAiRuntimeCache();
  });
});

test('the probe presents the configured credentials and does not retry a rejection', async () => {
  const seen = [];
  const probe = await probeFormalAiBackend({
    baseUrl: 'http://formal-ai.invalid',
    apiKey: 'operator-key',
    fetchImpl: async (url, options) => {
      seen.push({ url, headers: options.headers });
      return { ok: false, status: 401 };
    },
  });
  assert.equal(probe.kind, 'unauthorized');
  assert.equal(seen.length, 1, 'a rejected credential is still rejected on the next attempt');
  assert.equal(seen[0].headers.Authorization, 'Bearer operator-key');
  assert.throws(() => assertSupportedFormalAiBackend(probe, { baseUrl: 'http://formal-ai.invalid' }), /refused the configured credentials.*FORMAL_AI_API_KEY/s);
});

test('an unreachable endpoint gives up on its deadline instead of hanging', async () => {
  let clock = 0;
  const attempts = [];
  const probe = await probeFormalAiBackend({
    baseUrl: 'http://formal-ai.invalid',
    timeoutMs: 3_000,
    intervalMs: 1_000,
    now: () => clock,
    sleepImpl: async ms => void (clock += ms),
    fetchImpl: async () => {
      attempts.push(clock);
      clock += 100;
      throw new Error('fetch failed');
    },
  });
  assert.equal(probe.kind, 'unreachable');
  assert.deepEqual(attempts, [0, 1100, 2200], 'retried within the deadline, then stopped');
  assert.ok(clock <= 3_000, 'the probe never runs past its deadline');
  assert.throws(() => assertSupportedFormalAiBackend(probe, { baseUrl: 'http://formal-ai.invalid' }), /could not be reached.*HIVE_MIND_FORMAL_AI_BASE_URL/s);
});

// ---------------------------------------------------------------------------
// Caching must not make provenance stale.
// ---------------------------------------------------------------------------

test('a reused endpoint whose backend changed between tasks is re-probed', async () => {
  const versions = ['0.346.0', '0.347.0'];
  await withBackend(
    (request, response, count) => answerJson({ version: versions[Math.min(count, versions.length) - 1], memory: { compatible: true } })(request, response),
    async ({ baseUrl, requests }) => {
      resetFormalAiRuntimeCache();
      const workdir = await mkdtemp(join(tmpdir(), 'hive-2208-workspace-'));
      const first = await prepareAgainst({ baseUrl, workdir });
      try {
        assert.equal(first.formalAiVersion, '0.346.0');
        // The sidecar was updated and restarted behind the same address; the
        // cache key (tool + workdir + base URL) has not changed at all.
        const logs = [];
        const second = await prepareAgainst({ baseUrl, workdir, logs });
        assert.equal(second, first, 'the server and client configuration are still reused');
        assert.equal(second.formalAiVersion, '0.347.0', 'but the recorded provenance follows the backend');
        assert.equal(requests.length, 2, 'the endpoint is asked again rather than replayed from the cache');
        assert.ok(
          logs.some(line => line.includes('serving backend changed to') && line.includes('0.347.0')),
          `the change is on the record: ${JSON.stringify(logs)}`
        );
      } finally {
        await first.stop();
        await rm(workdir, { recursive: true, force: true });
        resetFormalAiRuntimeCache();
      }
    }
  );
});

// ---------------------------------------------------------------------------
// The leased sidecar image travels with the task (issues #2207 + #2208).
// ---------------------------------------------------------------------------

test('the leased image identity is published to the task and carried into provenance', async () => {
  const sidecar = { baseUrl: 'http://172.28.0.2:41235', imageReference: 'ghcr.io/link-assistant/formal-ai:latest', image: 'sha256:accepted', imageDigest: 'sha256:accepted', imageSource: 'accepted-update', servingVersion: '0.346.0' };
  const taskEnv = buildFormalAiTaskEnv({ sidecar, env: { PATH: '/usr/bin' } });
  assert.equal(taskEnv.HIVE_MIND_FORMAL_AI_BASE_URL, sidecar.baseUrl);
  assert.equal(taskEnv[FORMAL_AI_SIDECAR_PROVENANCE_ENV.imageDigest], 'sha256:accepted');
  assert.equal(taskEnv[FORMAL_AI_SIDECAR_PROVENANCE_ENV.image], 'ghcr.io/link-assistant/formal-ai:latest');
  assert.equal(taskEnv[FORMAL_AI_SIDECAR_PROVENANCE_ENV.version], '0.346.0');
  assert.deepEqual(readFormalAiSidecarProvenance(taskEnv), { image: sidecar.imageReference, imageDigest: 'sha256:accepted', version: '0.346.0', imageSource: 'accepted-update' });
  assert.deepEqual(buildFormalAiSidecarProvenanceEnv(null), {}, 'a task without a lease carries no provenance');
  assert.equal(buildFormalAiTaskEnv({ sidecar: null, env: { PATH: '/usr/bin' } }).HIVE_MIND_FORMAL_AI_BASE_URL, undefined);

  await withBackend(answerJson({ version: '0.346.0', memory: { compatible: true } }), async ({ baseUrl }) => {
    resetFormalAiRuntimeCache();
    const runtime = await prepareAgainst({ baseUrl, env: buildFormalAiSidecarProvenanceEnv(sidecar) });
    try {
      // A task's evidence can now name the immutable image that answered it.
      assert.equal(runtime.backend.imageDigest, 'sha256:accepted');
      assert.equal(runtime.backend.image, sidecar.imageReference);
      assert.equal(runtime.backend.managed, true);
      assert.equal(runtime.backend.version, '0.346.0');
    } finally {
      await runtime.stop();
      resetFormalAiRuntimeCache();
    }
  });
});

test('an endpoint that is not the leased image is refused rather than recorded', async () => {
  await withBackend(answerJson({ version: '0.344.0', memory: { compatible: true } }), async ({ baseUrl }) => {
    resetFormalAiRuntimeCache();
    await assert.rejects(prepareAgainst({ baseUrl, env: { [FORMAL_AI_SIDECAR_PROVENANCE_ENV.version]: '0.346.0', [FORMAL_AI_SIDECAR_PROVENANCE_ENV.imageDigest]: 'sha256:accepted' } }), /serves Formal AI 0\.344\.0, but the leased Hive Mind sidecar image was verified as 0\.346\.0/);
    resetFormalAiRuntimeCache();
  });
});
