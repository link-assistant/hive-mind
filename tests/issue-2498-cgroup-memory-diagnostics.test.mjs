/**
 * @hive-mind-test-suite default
 * Issue #2498 (PR #2499 review): "one out of memory event may have killed multiple tasks at once".
 *
 * The resource snapshots only knew the *host* memory (`os.totalmem()`, `/proc/meminfo`), so the
 * logs could not tell whether the container hit its own 25%-of-host cgroup limit or the whole
 * host ran out, nor how many processes the OOM killer took. Each snapshot now also records the
 * cgroup's limit, usage, peak and the `memory.events` counters `oom` (times the cgroup hit its own
 * limit) and `oom_kill` (processes of the cgroup killed by any OOM killer).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readCgroupMemory, captureResourceSnapshot, buildResourceMarker, parseResourceMarkers, formatResourceSnapshotForLog } from '../src/solve.resource-diagnostics.lib.mjs';

const LIMIT = 3_135_373_312; // 25% of the 11.7 GB host, as seen in the incident containers.

function fakeReader(files) {
  return filePath => {
    if (Object.hasOwn(files, filePath)) return files[filePath];
    const error = new Error(`ENOENT: ${filePath}`);
    error.code = 'ENOENT';
    throw error;
  };
}

const V2_FILES = {
  '/proc/self/cgroup': '0::/\n',
  '/sys/fs/cgroup/memory.max': `${LIMIT}\n`,
  '/sys/fs/cgroup/memory.current': '2900000000\n',
  '/sys/fs/cgroup/memory.peak': `${LIMIT}\n`,
  '/sys/fs/cgroup/memory.events': 'low 0\nhigh 0\nmax 412\noom 2\noom_kill 5\noom_group_kill 0\n',
};

test('cgroup v2: limit, usage, peak and OOM counters are read', () => {
  assert.deepEqual(readCgroupMemory(fakeReader(V2_FILES), 'linux'), {
    version: 2,
    path: '/sys/fs/cgroup',
    limitBytes: LIMIT,
    currentBytes: 2_900_000_000,
    peakBytes: LIMIT,
    oomEvents: 2,
    oomKills: 5,
  });
});

test('cgroup v2: the process own cgroup path is preferred, and "max" means no limit of its own', () => {
  const files = {
    '/proc/self/cgroup': '0::/system.slice/docker-abc.scope\n',
    '/sys/fs/cgroup/system.slice/docker-abc.scope/memory.max': 'max\n',
    '/sys/fs/cgroup/system.slice/docker-abc.scope/memory.current': '1024\n',
    '/sys/fs/cgroup/memory.max': '1\n',
  };
  const cgroup = readCgroupMemory(fakeReader(files), 'linux');
  assert.equal(cgroup.path, '/sys/fs/cgroup/system.slice/docker-abc.scope');
  assert.equal(cgroup.limitBytes, null);
  assert.equal(cgroup.currentBytes, 1024);
  assert.equal(cgroup.oomKills, null, 'no memory.events file, no counter');
});

test('cgroup v1 fallback, and nothing at all outside Linux or without a memory controller', () => {
  const v1 = readCgroupMemory(
    fakeReader({
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712\n',
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': '500\n',
      '/sys/fs/cgroup/memory/memory.max_usage_in_bytes': '700\n',
      '/sys/fs/cgroup/memory/memory.oom_control': 'oom_kill_disable 0\nunder_oom 0\noom_kill 3\n',
    }),
    'linux'
  );
  assert.deepEqual(v1, { version: 1, path: '/sys/fs/cgroup/memory', limitBytes: null, currentBytes: 500, peakBytes: 700, oomEvents: null, oomKills: 3 });
  assert.equal(readCgroupMemory(fakeReader({}), 'linux'), null);
  assert.equal(readCgroupMemory(fakeReader(V2_FILES), 'darwin'), null);
});

test('the snapshot marker carries the cgroup data, and old markers still parse', () => {
  const snapshot = captureResourceSnapshot({
    phase: 'solve_exit',
    fsImpl: { readFileSync: fakeReader(V2_FILES), statfsSync: () => ({ bsize: 4096, blocks: 1000, bfree: 500, bavail: 500 }) },
    processImpl: { platform: 'linux', memoryUsage: () => ({ rss: 1, heapUsed: 1, heapTotal: 1, external: 0 }) },
  });
  assert.equal(snapshot.cgroupMemory?.oomKills, 5);
  const marker = buildResourceMarker(snapshot);
  assert.match(marker, /cgroupVersion=2/);
  assert.match(marker, new RegExp(`cgroupMemLimitBytes=${LIMIT}`));
  assert.match(marker, /cgroupOomEvents=2/);
  assert.match(marker, /cgroupOomKills=5/);

  const {
    markers: [parsed],
  } = parseResourceMarkers(`[2026-10-04T19:44:10.000Z] [INFO] ${marker}\n`);
  assert.deepEqual(parsed.cgroupMemory, { version: 2, limitBytes: LIMIT, currentBytes: 2_900_000_000, peakBytes: LIMIT, oomEvents: 2, oomKills: 5 });

  const {
    markers: [old],
  } = parseResourceMarkers('📈 [RESOURCES] phase=solve_exit rssBytes=1\n');
  assert.equal(old.cgroupMemory, null);
});

test('the log says how many processes the OOM killer took in this container', () => {
  const text = formatResourceSnapshotForLog({ phase: 'solve_exit', memory: {}, disk: {}, cgroupMemory: readCgroupMemory(fakeReader(V2_FILES), 'linux') });
  assert.match(text, /Container memory \(cgroup v2\): .* used of 2\.9 GB limit, peak 2\.9 GB; processes killed by the OOM killer so far: 5/);
  assert.match(text, /The kernel OOM killer has killed 5 process\(es\) in this container's cgroup; memory.events oom=2/);

  const quiet = formatResourceSnapshotForLog({ phase: 'solve_start', memory: {}, disk: {}, cgroupMemory: { version: 2, limitBytes: null, currentBytes: 10, peakBytes: null, oomEvents: 0, oomKills: 0 } });
  assert.match(quiet, /no limit of its own; processes killed by the OOM killer so far: 0/);
  assert.doesNotMatch(quiet, /⚠️ {2}The kernel OOM killer/);
});

test('the kill diagnosis quotes the last in-container cgroup reading as evidence', async () => {
  const { describeKillCause } = await import('../src/session-kill-diagnostics.lib.mjs');
  const marker = `📈 [RESOURCES] phase=solve_exit ts=2026-10-04T19:44:10.000Z cgroupVersion=2 cgroupMemLimitBytes=${LIMIT} cgroupMemCurrentBytes=2900000000 cgroupMemPeakBytes=${LIMIT} cgroupOomEvents=2 cgroupOomKills=5`;
  const diagnosis = describeKillCause({ logText: `${marker}\n`, oomKilled: true, exitCode: 1 });
  assert.match(diagnosis.evidence.join('\n'), /last session container cgroup reading — 2\.7 GB used, 2\.9 GB limit, peak 2\.9 GB, 5 process\(es\) killed by the OOM killer, memory\.events oom=2 at 2026-10-04T19:44:10\.000Z \(phase `solve_exit`\)/);
  assert.doesNotMatch(describeKillCause({ logText: '📈 [RESOURCES] phase=solve_exit rssBytes=1\n', exitCode: 1 }).evidence.join('\n'), /cgroup reading/);
});
