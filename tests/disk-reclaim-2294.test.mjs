/**
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2294
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scan, clean, emergency, LocalEnv } from 'disk-space-saviour';
import { ensureDiskSpaceForWorker } from '../src/disk-guard.lib.mjs';
import { reclaimDiskSpace, probeDiskSpaceWithReclaim, startWorkspaceReclaim } from '../src/disk-reclaim.lib.mjs';
import { createResourceSafeExit } from '../src/solve.resource-diagnostics.lib.mjs';
import { runBunCacheCleanup, withBunCacheFixture } from '../experiments/issue-2294-bun-cache.mjs';

const guardOptions = {
  requiredMB: 100,
  agentDataHome: null,
  fileSystem: { readdir: async () => [] },
  collectReclaimable: null,
};

test('low disk space triggers cache reclaim before refusing a worker', async () => {
  let freeMB = 10;
  let attempts = 0;
  const result = await ensureDiskSpaceForWorker({
    ...guardOptions,
    getFreeMB: async () => freeMB,
    reclaimDiskSpace: async ({ requiredMB, diskPath }) => {
      assert.equal(requiredMB, 100);
      assert.equal(diskPath, '/tmp');
      attempts++;
      freeMB = 120;
      return { freedBytes: 110 * 1024 * 1024 };
    },
  });
  assert.equal(attempts, 1);
  assert.equal(result.ok, true);
  assert.equal(result.freeMB, 120);
});

test('sufficient or unknown disk space does not run reclaim', async () => {
  for (const freeMB of [120, null]) {
    const result = await ensureDiskSpaceForWorker({
      ...guardOptions,
      getFreeMB: async () => freeMB,
      reclaimDiskSpace: async () => assert.fail('unexpected reclaim'),
    });
    assert.equal(result.ok, true);
  }
});

test('reclaim cannot admit work based on an optimistic freed-byte estimate', async () => {
  let attempts = 0;
  const result = await ensureDiskSpaceForWorker({
    ...guardOptions,
    getFreeMB: async () => 10,
    reclaimDiskSpace: async () => {
      attempts++;
      return { freedBytes: 9999999999 };
    },
  });
  assert.equal(attempts, 1);
  assert.equal(result.ok, false);
  assert.equal(result.freeMB, 10);
});

const report = { totals: { safe: { bytes: 1024, items: 1 } }, errors: [], items: [] };
const entry = { rule: 'bun-cache', status: 'removed', deletedPaths: ['/home/box/.bun/install/cache'], freedBytes: 1024 };

test('host reclaim caps the emergency tier, disables Docker and logs every action', async () => {
  const logs = [];
  let scanned;
  const audit = await reclaimDiskSpace({
    requiredMB: 100,
    diskPath: '/work',
    protectedPaths: new Set(['/keep']),
    env: {},
    log: async message => logs.push(message),
    load: async () => ({
      scan: async options => {
        scanned = options;
        return report;
      },
      emergency: async options => {
        assert.equal(options.tier, 'safe');
        assert.equal(options.docker, false);
        assert.equal(options.removeStoppedContainers, false);
        assert.deepEqual(options.removeContainers, []);
        assert.deepEqual(options.removeImages, []);
        assert.equal(options.allowDirtyRepos, false);
        assert.equal(options.path, '/work');
        assert.equal(options.free, 100 * 1024 * 1024);
        assert.equal(options.report, report);
        options.onEntry(entry);
        return { freedBytes: 1024, file: '/audit.json' };
      },
    }),
  });
  assert.deepEqual(scanned.scanners, ['global']);
  assert.deepEqual(scanned.exclude, ['/keep']);
  assert.equal(scanned.noNative, true);
  assert(scanned.only.includes('bun-cache'));
  assert(!scanned.only.includes('node-modules'));
  assert(!scanned.only.includes('opam-download-cache'));
  assert.equal(audit.freedBytes, 1024);
  assert(logs.some(line => line.includes('[DSS_SCAN]')));
  assert(logs.some(line => line.includes(JSON.stringify(entry))));
  assert(logs.some(line => line.includes('/audit.json')));
});

test('off or unsupported modes cannot load or delete anything', async () => {
  for (const mode of ['off', 'moderate', 'aggressive', 'invalid']) {
    assert.equal(await reclaimDiskSpace({ env: { HIVE_MIND_AUTO_RECLAIM: mode }, load: async () => assert.fail('unexpected import') }), null);
  }
});

test('missing DSS or failed scans fall back to the existing disk gate', async () => {
  const logs = [];
  const result = await reclaimDiskSpace({
    env: {},
    log: async line => logs.push(line),
    load: async () => {
      throw new Error('scan unavailable');
    },
  });
  assert.equal(result, null);
  assert(logs.some(line => line.includes('scan unavailable')));
});

test('workspace passes select only superseded Rust artifacts in this workspace', async () => {
  let scanned;
  await reclaimDiskSpace({
    workspace: '/task/repo',
    env: { HIVE_MIND_RECLAIM_STALE_AGE: '2h' },
    load: async () => ({
      scan: async options => {
        scanned = options;
        return report;
      },
      clean: async (input, options) => {
        assert.equal(input, report);
        assert.equal(options.tier, 'safe');
        assert.equal(options.docker, false);
        return { freedBytes: 0 };
      },
      emergency: async () => assert.fail('workspace pass cannot escalate'),
    }),
  });
  assert.deepEqual(scanned.roots, ['/task/repo']);
  assert.deepEqual(scanned.scanners, ['projects']);
  assert.deepEqual(scanned.only, ['cargo-superseded', 'cargo-superseded-leaf']);
  assert.equal(scanned.olderThan, '2h');
});

test('solve pre-flight remeasures real free space after reclaim', async () => {
  const values = [10, 120];
  let attempts = 0;
  assert.equal(
    await probeDiskSpaceWithReclaim({
      requiredMB: 100,
      diskPath: '/work',
      getFreeMB: async () => values.shift(),
      reclaim: async options => {
        attempts++;
        assert.equal(options.diskPath, '/work');
      },
    }),
    120
  );
  assert.equal(attempts, 1);
  for (const available of [120, NaN, null]) {
    assert.equal(await probeDiskSpaceWithReclaim({ requiredMB: 100, getFreeMB: async () => available, reclaim: async () => assert.fail('unexpected reclaim') }), available);
  }
});

test('maintenance passes never overlap, and stop waits for periodic and final passes', async () => {
  const callbacks = [];
  let release;
  let passes = 0;
  let cleared = 0;
  const stop = startWorkspaceReclaim({
    workspace: '/task/repo',
    env: {},
    setTimer: fn => {
      callbacks.push(fn);
      return { unref() {} };
    },
    clearTimer: () => {
      cleared++;
    },
    reclaim: async () => {
      passes++;
      if (passes === 1)
        await new Promise(resolve => {
          release = resolve;
        });
    },
  });
  callbacks[0]();
  await Promise.resolve();
  assert.equal(passes, 1);
  assert.equal(callbacks.length, 1);
  let stopped = false;
  const done = stop({ final: true }).then(() => {
    stopped = true;
  });
  const concurrentStop = stop();
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await Promise.all([done, concurrentStop]);
  assert.equal(passes, 2);
  assert.equal(callbacks.length, 1);
  assert.equal(cleared, 1);
  await stop({ final: true });
  assert.equal(passes, 2);
});

test('disabled workspace maintenance installs no timer', async () => {
  const stop = startWorkspaceReclaim({ workspace: '/task', env: { HIVE_MIND_AUTO_RECLAIM: 'off' }, setTimer: () => assert.fail('unexpected timer') });
  await stop({ final: true });
});

test('safe exit drains maintenance before recording resources or exiting', async () => {
  const calls = [];
  const exit = createResourceSafeExit({ beforeExit: async () => calls.push('drain'), record: async () => calls.push('record'), exit: async (code, reason, options) => calls.push([code, reason, options]) });
  await exit(75, 'disk full', { skipPreExit: true });
  await exit();
  assert.deepEqual(calls, ['drain', 'record', [75, 'disk full', { skipPreExit: true }], 'drain', [0, 'Process completed', {}]]);
});

// Exercise the pinned DSS package against real files while mocking only process
// visibility. No host cache, Docker daemon or external repository is touched.
test('real DSS preserves the newest Rust hash and active builds', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-reclaim-2294-'));
  const profile = path.join(root, 'target/debug');
  let processes = [];
  let openPaths = new Set();
  class FixtureEnv extends LocalEnv {
    async processes() {
      return processes;
    }
    async openPaths() {
      return openPaths;
    }
  }
  const fixture = new FixtureEnv({ homes: [], tmpDirs: [] });
  const load = async () => ({
    scan: options => scan({ ...options, env: fixture }),
    clean: (report, options) => clean(report, { ...options, env: fixture, audit: false }),
    emergency: options => emergency({ ...options, env: fixture, audit: false }),
  });
  const unit = async (hash, ageHours) => {
    const fingerprint = path.join(profile, '.fingerprint', `foo-${hash}`);
    await fs.mkdir(fingerprint, { recursive: true });
    const files = [path.join(fingerprint, 'lib-foo.json'), path.join(profile, 'deps', `libfoo-${hash}.rlib`), path.join(profile, 'deps', `foo-${hash}.d`)];
    await fs.writeFile(files[0], '{"rustc":1,"features":"[]","target":42,"profile":7}');
    await fs.writeFile(files[1], Buffer.alloc(2 * 1024 * 1024));
    await fs.writeFile(files[2], `${files[1]}: src/lib.rs\n`);
    const age = new Date(Date.now() - ageHours * 3600000);
    for (const file of [...files, fingerprint]) await fs.utimes(file, age, age);
    return files[1];
  };
  try {
    await fs.mkdir(path.join(profile, 'deps'), { recursive: true });
    await fs.writeFile(path.join(root, 'Cargo.toml'), '[package]\nname = "foo"\n');
    await fs.writeFile(path.join(root, 'target/CACHEDIR.TAG'), '');
    const old = await unit('0123456789abcdef', 72);
    const latest = await unit('fedcba9876543210', 2);
    processes = [{ pid: 200, name: 'cargo', cwd: root, startTime: '1' }];
    await reclaimDiskSpace({ workspace: root, env: {}, load });
    await fs.access(old);
    processes = [];
    openPaths = new Set([old]);
    await reclaimDiskSpace({ workspace: root, env: {}, load });
    await fs.access(old);
    openPaths = null;
    await reclaimDiskSpace({ workspace: root, env: {}, load });
    await fs.access(old);
    openPaths = new Set();
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'add', old]);
    await reclaimDiskSpace({ workspace: root, env: {}, load });
    await fs.access(old);
    execFileSync('git', ['-C', root, 'rm', '--cached', '-q', old]);
    const audit = await reclaimDiskSpace({ workspace: root, env: {}, load });
    assert(audit.entries.some(entry => entry.rule === 'cargo-superseded' && entry.status === 'removed'));
    await assert.rejects(fs.access(old), { code: 'ENOENT' });
    await fs.access(latest);
    await fs.access(path.join(root, 'Cargo.toml'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('npm and Bun caches are cleared in each Docker installation layer', async () => {
  for (const filename of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
    const content = await fs.readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    const runs = content.match(/^RUN .*?(?:\\\n.*?)*$/gm);
    assert(runs?.length > 0);
    for (const run of runs) {
      if (run.includes('bun install -g')) assert(run.includes('bun pm -g cache rm'), `${filename}: ${run}`);
      if (run.includes('npm install -g')) assert(run.includes('npm cache clean --force'), `${filename}: ${run}`);
    }
  }
});

test('Docker Bun cleanup works without a project manifest and preserves installed CLIs', { timeout: 30000 }, async t => {
  if (spawnSync('bun', ['--version']).error?.code === 'ENOENT') return t.skip('Bun is validated by the Docker build job');
  const content = await fs.readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const command = content.match(/\bbun pm[^&;\n]*/)[0];
  const result = await runBunCacheCleanup(command.trim().split(/\s+/).slice(1));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.cacheExists, false);
  assert.equal(result.cliContents, 'installed CLI must survive');
});

test('host Bun reclaim cleans only scanned cache paths without requiring a project manifest', { timeout: 30000 }, async t => {
  if (spawnSync('bun', ['--version']).error?.code === 'ENOENT') return t.skip('Bun is unavailable');
  await withBunCacheFixture(async ({ root, cache, cli, options }) => {
    class FixtureEnv extends LocalEnv {
      async processes() {
        return [];
      }
      async openPaths() {
        return new Set();
      }
      async diskUsage() {
        const present = await this.exists(cache);
        return { total: 200 * 1024 * 1024, free: present ? 0 : 150 * 1024 * 1024, used: present ? 200 * 1024 * 1024 : 50 * 1024 * 1024 };
      }
      run(argv, input) {
        if (argv[0] !== 'bun') return super.run(argv, input);
        const result = spawnSync('bun', argv.slice(1), options);
        return Promise.resolve({ code: result.status, stdout: result.stdout, stderr: result.stderr });
      }
    }
    const fixture = new FixtureEnv({ homes: [root], tmpDirs: [], vars: {} });
    fixture.currentHome = root;
    const audit = await reclaimDiskSpace({
      requiredMB: 100,
      diskPath: root,
      env: {},
      load: async () => ({
        scan: input => scan({ ...input, env: fixture }),
        emergency: input => emergency({ ...input, env: fixture, audit: false }),
      }),
    });
    assert(
      audit.entries.some(entry => entry.rule === 'bun-cache' && entry.status === 'removed'),
      JSON.stringify(audit.entries)
    );
    await assert.rejects(fs.access(cache), { code: 'ENOENT' });
    assert.equal(await fs.readFile(cli, 'utf8'), 'installed CLI must survive');
  });
});
