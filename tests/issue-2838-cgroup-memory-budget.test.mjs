/**
 * @hive-mind-test-suite default
 * Issue #2838: inside a Docker task the memory preflight and the "System resources" lines read the
 * *host* `/proc/meminfo` ("11117MB available, swap: 4095MB") while the task's cgroup was capped at
 * 2.92 GiB with no swap, so builds kept being OOM-killed. Available memory is
 * min(host available, memory.max - memory.current) and swap is capped by memory.swap.max.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readCgroupMemory } from '../src/solve.resource-diagnostics.lib.mjs';
import { computeEffectiveMemory, describeMemoryLimit, formatMemorySummary, parseMeminfo, readEffectiveMemory } from '../src/cgroup-memory-budget.lib.mjs';

const MiB = 1024 * 1024;
const LIMIT = 3_135_373_312; // the incident containers: Memory = MemorySwap = 2.92 GiB

function fakeReader(files) {
  return filePath => {
    if (Object.hasOwn(files, filePath)) return files[filePath];
    const error = new Error(`ENOENT: ${filePath}`);
    error.code = 'ENOENT';
    throw error;
  };
}

// The host side of the incident log: "11117MB available, swap: 4095MB (0MB used)".
const HOST_MEMINFO = ['MemTotal:       12247544 kB', 'MemFree:         3953344 kB', 'MemAvailable:    8896740 kB', 'Buffers:          200000 kB', 'Cached:          7000000 kB', 'SReclaimable:     230464 kB', 'SwapTotal:       4194300 kB', 'SwapFree:        4194300 kB', ''].join('\n');

const CONTAINER_FILES = {
  '/proc/self/cgroup': '0::/\n',
  '/proc/meminfo': HOST_MEMINFO,
  '/sys/fs/cgroup/memory.max': `${LIMIT}\n`,
  '/sys/fs/cgroup/memory.current': '2900000000\n',
  '/sys/fs/cgroup/memory.swap.max': '0\n',
  '/sys/fs/cgroup/memory.swap.current': '0\n',
};

test('readCgroupMemory reads the swap limit and usage (v2 and v1)', () => {
  const v2 = readCgroupMemory(fakeReader(CONTAINER_FILES), 'linux');
  assert.equal(v2.swapLimitBytes, 0, '--memory-swap equal to --memory leaves memory.swap.max at 0');
  assert.equal(v2.swapCurrentBytes, 0);
  const unlimited = readCgroupMemory(fakeReader({ ...CONTAINER_FILES, '/sys/fs/cgroup/memory.swap.max': 'max\n' }), 'linux');
  assert.equal(unlimited.swapLimitBytes, null, '"max" is no swap limit of its own');
  const v1 = readCgroupMemory(
    fakeReader({
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': `${1024 * MiB}\n`,
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': `${100 * MiB}\n`,
      '/sys/fs/cgroup/memory/memory.memsw.limit_in_bytes': `${1536 * MiB}\n`,
      '/sys/fs/cgroup/memory/memory.memsw.usage_in_bytes': `${110 * MiB}\n`,
    }),
    'linux'
  );
  assert.equal(v1.swapLimitBytes, 512 * MiB, 'v1 memsw counts memory plus swap');
  assert.equal(v1.swapCurrentBytes, 10 * MiB);
});

test('available memory is the cgroup headroom when it is below the host value', () => {
  const effective = computeEffectiveMemory({ meminfo: parseMeminfo(HOST_MEMINFO), cgroup: readCgroupMemory(fakeReader(CONTAINER_FILES), 'linux') });
  assert.equal(effective.hostAvailableMB, 11117, 'the host value the old preflight printed');
  assert.equal(effective.availableMB, Math.floor((LIMIT - 2_900_000_000) / MiB));
  assert.equal(effective.limitedBy, 'cgroup');
  assert.equal(effective.swapTotalMB, 0, 'memory.swap.max=0: the host swap is not usable');
  assert.equal(effective.swapAvailableMB, 0);
  assert.equal(effective.totalAvailableMB, effective.availableMB);
  assert.match(describeMemoryLimit(effective), /limited by cgroup v2 memory\.max \(2990MB limit, 2765MB used\); host: 11117MB available/);
  assert.match(formatMemorySummary(effective), /^Container memory \(cgroup v2\): 224MB available of 2990MB limit \(2765MB used\), swap: none \(memory\.swap\.max is 0\); host: 11117MB available$/);
});

test('without a cgroup limit the host values are kept', () => {
  const effective = computeEffectiveMemory({ meminfo: parseMeminfo(HOST_MEMINFO), cgroup: { version: 2, limitBytes: null, currentBytes: 10, swapLimitBytes: null, swapCurrentBytes: null } });
  assert.equal(effective.availableMB, 11117);
  assert.equal(effective.limitedBy, 'host');
  assert.equal(effective.swapTotalMB, 4095);
  assert.equal(effective.totalAvailableMB, 11117 + 4095);
  assert.equal(describeMemoryLimit(effective), '');
  assert.equal(formatMemorySummary(effective), 'Memory: 11117MB available, swap: 4095MB (0MB used)');
  assert.equal(computeEffectiveMemory({ meminfo: parseMeminfo(HOST_MEMINFO), cgroup: null }).availableMB, 11117);
});

test('a swap limit above zero caps the usable host swap', () => {
  const cgroup = { version: 2, limitBytes: 8192 * MiB, currentBytes: 1024 * MiB, swapLimitBytes: 1024 * MiB, swapCurrentBytes: 256 * MiB };
  const effective = computeEffectiveMemory({ meminfo: parseMeminfo(HOST_MEMINFO), cgroup });
  assert.equal(effective.limitedBy, 'cgroup');
  assert.equal(effective.swapTotalMB, 1024);
  assert.equal(effective.swapUsedMB, 256);
  assert.equal(effective.swapAvailableMB, 768);
});

test('a host with less free memory than the cgroup headroom is limited by the host', () => {
  const effective = computeEffectiveMemory({ meminfo: parseMeminfo('MemFree: 102400 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'), cgroup: { version: 2, limitBytes: 4096 * MiB, currentBytes: 0 } });
  assert.equal(effective.availableMB, 100);
  assert.equal(effective.limitedBy, 'host');
  assert.match(describeMemoryLimit(effective), /limited by host memory; cgroup v2 limit 4096MB/);
});

test('readEffectiveMemory reads /proc/meminfo and the cgroup through one injectable reader', () => {
  const effective = readEffectiveMemory({ readFileSync: fakeReader(CONTAINER_FILES), platform: 'linux' });
  assert.equal(effective.limitedBy, 'cgroup');
  assert.equal(readEffectiveMemory({ readFileSync: fakeReader(CONTAINER_FILES), platform: 'darwin' }), null);
  assert.equal(readEffectiveMemory({ readFileSync: fakeReader({}), platform: 'linux' }), null, 'no /proc/meminfo, no reading');
});

test('checkRAM and getResourceSnapshot report the cgroup-aware value', async () => {
  const { checkRAM, getResourceSnapshot } = await import('../src/memory-check.mjs');
  const logs = [];
  const result = await checkRAM(256, { log: async line => logs.push(line), readEffectiveMemory: () => readEffectiveMemory({ readFileSync: fakeReader(CONTAINER_FILES), platform: 'linux' }) });
  assert.equal(result.success, false, '224MB in the container is below the 256MB requirement');
  assert.equal(result.availableMB, 224);
  assert.equal(result.hostAvailableMB, 11117);
  assert.equal(result.limitedBy, 'cgroup');
  assert.match(logs[0], /^❌ Insufficient memory: 224MB available, swap: none \(memory\.swap\.max is 0\), total: 224MB \(256MB required\), limited by cgroup v2 memory\.max/);
  assert.ok(!logs.some(line => /swapfile/.test(line)), 'host swap advice does not help inside the cgroup');

  const ok = await checkRAM(128, { log: async line => logs.push(line), readEffectiveMemory: () => readEffectiveMemory({ readFileSync: fakeReader(CONTAINER_FILES), platform: 'linux' }) });
  assert.equal(ok.success, true);

  if (process.platform === 'linux') {
    const snapshot = await getResourceSnapshot({ readEffectiveMemory: () => readEffectiveMemory({ readFileSync: fakeReader(CONTAINER_FILES), platform: 'linux' }) });
    assert.match(snapshot.memorySummary, /^Container memory \(cgroup v2\): 224MB available of 2990MB limit/);
    assert.equal(snapshot.memory.split('\n')[1], snapshot.memorySummary, 'every "System resources" log line (memory.split(\'\\n\')[1]) shows the cgroup-aware value');
  }
});
