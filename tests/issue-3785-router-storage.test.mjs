/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireRouterSidecar, buildRouterSidecarRunArgs } from '../src/router-sidecar.lib.mjs';
import { ROUTER_STORAGE_INSPECT_FORMAT, verifyRouterSidecarStorage } from '../src/router-storage-contract.lib.mjs';
import { ROUTER_SIDECAR_NETWORK_NAME } from '../src/router-isolation.lib.mjs';

const healthy = () => ({ env: ['TOKEN_SECRET=synthetic-private-sentinel', 'DATA_DIR=/data/router', 'AUDIT_LOG=/data/router/audit.jsonl'], mounts: [{ Type: 'volume', Name: 'hive-mind-router-data', Destination: '/data/router', RW: true }] });

for (const extra of ['--env AUDIT_LOG=/tmp/synthetic-audit', '-e DATA_DIR=/tmp/synthetic-data', '--env=AUDIT_LOG=', '-eDATA_DIR=/tmp/synthetic-data', '--env-file /tmp/synthetic-env', '--volume /tmp/synthetic:/data/router', '-v/tmp/synthetic:/data/router', '--mount=type=tmpfs,destination=/data/router', '--tmpfs /data/router', '--entrypoint /bin/true', '--network host', '--privileged', '--volumes-from synthetic-other', '--label hive-mind.router=other', '-- unknown-image']) {
  test(`sidecar authority cannot be overridden by extra argument ${extra.split(/[ =]/u)[0]}`, () => {
    assert.throws(
      () => buildRouterSidecarRunArgs({ image: 'synthetic/router:1', tokenSecret: 'synthetic-signing-key', env: { HIVE_MIND_ROUTER_EXTRA_ARGS: extra } }),
      error => /Router.*resource arguments/iu.test(error.message) && !error.message.includes('synthetic')
    );
  });
}

test('supported sidecar resource settings preserve the durable audit declaration', () => {
  const args = buildRouterSidecarRunArgs({ image: 'synthetic/router:1', tokenSecret: 'synthetic-signing-key', env: { HIVE_MIND_ROUTER_EXTRA_ARGS: '--cpus=1.5 --memory 512m --pids-limit=128' } });
  assert.ok(args.includes('--cpus=1.5'));
  assert.ok(args.includes('--memory'));
  assert.ok(args.includes('512m'));
  assert.equal(args.filter(value => value === 'AUDIT_LOG=/data/router/audit.jsonl').length, 1);
  assert.equal(args.filter(value => value === 'DATA_DIR=/data/router').length, 1);
  assert.equal(args.filter(value => value === 'hive-mind-router-data:/data/router').length, 1);
});

for (const extra of ['--cpus=0', '--cpus=0.000000', '--memory', '--memory 0', '--memory 1g --memory=2g', '--pids-limit=-1', '--cpus=1=2', '--cpuset-cpus=0;synthetic', 'x'.repeat(4097)]) {
  test('invalid or ambiguous extra resource settings refuse without input excerpts', () => {
    assert.throws(
      () => buildRouterSidecarRunArgs({ env: { HIVE_MIND_ROUTER_EXTRA_ARGS: extra } }),
      error => /Router.*resource arguments/iu.test(error.message) && !error.message.includes('synthetic')
    );
  });
}

test('actual declared durable audit volume is accepted', async () => {
  const calls = [];
  const result = await verifyRouterSidecarStorage({ run: async (_binary, args) => (calls.push(args), { stdout: JSON.stringify(healthy()) }) });
  assert.deepEqual(result, { valid: true, error: null });
  assert.equal(calls[0].at(-1), ROUTER_STORAGE_INSPECT_FORMAT);
});

const mutations = [
  [
    'missing volume',
    data => {
      data.mounts = [];
    },
  ],
  [
    'wrong named volume',
    data => {
      data.mounts[0].Name = 'synthetic-other-volume';
    },
  ],
  [
    'read-only volume',
    data => {
      data.mounts[0].RW = false;
    },
  ],
  [
    'bind copy',
    data => {
      data.mounts[0].Type = 'bind';
    },
  ],
  [
    'tmpfs replacement',
    data => {
      data.mounts[0].Type = 'tmpfs';
    },
  ],
  [
    'parent mount',
    data => {
      data.mounts.push({ Destination: '/data' });
    },
  ],
  [
    'root mount',
    data => {
      data.mounts.push({ Destination: '/' });
    },
  ],
  [
    'nested audit mount',
    data => {
      data.mounts.push({ Destination: '/data/router/audit.jsonl' });
    },
  ],
  [
    'ambiguous destination',
    data => {
      data.mounts.push({ Destination: '/data//router' });
    },
  ],
  [
    'ambiguous parent',
    data => {
      data.mounts.push({ Destination: '/data/' });
    },
  ],
  [
    'traversing destination',
    data => {
      data.mounts.push({ Destination: '/tmp/../data/router' });
    },
  ],
  [
    'duplicate volume',
    data => {
      data.mounts.push({ ...data.mounts[0] });
    },
  ],
  [
    'missing audit declaration',
    data => {
      data.env.pop();
    },
  ],
  [
    'private audit path',
    data => {
      data.env[2] = 'AUDIT_LOG=/tmp/synthetic-private-sentinel';
    },
  ],
  [
    'private data path',
    data => {
      data.env[1] = 'DATA_DIR=/tmp/synthetic-private-sentinel';
    },
  ],
  [
    'duplicate audit declaration',
    data => {
      data.env.push('AUDIT_LOG=/data/router/audit.jsonl');
    },
  ],
  [
    'duplicate data declaration',
    data => {
      data.env.push('DATA_DIR=/data/router');
    },
  ],
  [
    'invalid environment',
    data => {
      data.env = null;
    },
  ],
  [
    'invalid mounts',
    data => {
      data.mounts = null;
    },
  ],
];

for (const [name, mutate] of mutations) {
  test(`actual sidecar storage refuses ${name} without exposing inspection values`, async () => {
    const data = healthy();
    mutate(data);
    const result = await verifyRouterSidecarStorage({ run: async () => ({ stdout: JSON.stringify(data) }) });
    assert.equal(result.valid, false);
    assert.match(result.error, /storage.*verified/iu);
    assert.ok(!result.error.includes('sentinel'));
  });
}

for (const raw of ['synthetic-private-sentinel', JSON.stringify({ ...healthy(), padding: 'x'.repeat(256 * 1024) })]) {
  test('unparseable or oversized inspection refuses', async () => {
    const result = await verifyRouterSidecarStorage({ run: async () => ({ stdout: raw }) });
    assert.equal(result.valid, false);
    assert.ok(!result.error.includes('sentinel'));
  });
}

test('failed Docker inspection refuses without publishing its error', async () => {
  const result = await verifyRouterSidecarStorage({
    run: async () => {
      throw new Error('synthetic-private-sentinel');
    },
  });
  assert.equal(result.valid, false);
  assert.ok(!result.error.includes('sentinel'));
});

for (const valid of [false, true]) {
  test(`reused sidecar ${valid ? 'issues' : 'refuses'} a task token after actual storage inspection`, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hive-router-storage-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const env = { HIVE_MIND_STATE_DIR: root };
    let minted = 0;
    let inspected = 0;
    const result = await acquireRouterSidecar({
      sessionId: 'synthetic-task',
      env,
      lockOptions: { env },
      healthAttempts: 1,
      run: async (_binary, args) => {
        if (args[0] === 'inspect') {
          if (args.at(-1) === ROUTER_STORAGE_INSPECT_FORMAT) {
            inspected++;
            const data = healthy();
            if (!valid) data.mounts = [];
            return { stdout: JSON.stringify(data) };
          }
          if (args.at(-1) === '{{.HostConfig.NetworkMode}}') return { stdout: ROUTER_SIDECAR_NETWORK_NAME };
          return { stdout: 'true|synthetic/router:1|sha256:synthetic|running' };
        }
        if (args[0] === 'network' && args[1] === 'inspect') return { stdout: 'true|1' };
        if (args.includes('issue')) {
          assert.equal(inspected, 1);
          minted++;
          return { stdout: `la_sk_h.${Buffer.from(JSON.stringify({ sub: 'synthetic-task-id' })).toString('base64url')}.s` };
        }
        return { stdout: '' };
      },
    });
    assert.equal(inspected, 1);
    assert.equal(minted, valid ? 1 : 0);
    assert.equal(result.error === null, valid);
    assert.equal(result.token === null, !valid);
  });
}

test('unsafe sidecar options reject before any Docker command or lease', async () => {
  let called = 0;
  const result = await acquireRouterSidecar({
    sessionId: 'synthetic-task',
    env: { HIVE_MIND_ROUTER_EXTRA_ARGS: '--tmpfs /data/router' },
    run: async () => {
      called++;
    },
  });
  assert.equal(called, 0);
  assert.equal(result.token, null);
  assert.match(result.error, /resource arguments/iu);
});
