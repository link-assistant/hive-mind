/** @hive-mind-test-suite default */
// Issue #3125: the memory preflight read /proc/meminfo and reported
// "10220MB available, swap: 4095MB" inside a 2.92 GiB container without swap.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { capMemoryToCgroup } from '../src/solve.resource-diagnostics.lib.mjs';

const MiB = 1024 * 1024;
const LIMIT = 3135369216; // memory.max in links-notation#340
const DIR = '/sys/fs/cgroup';
const files = extra => path => {
  const content = { [`${DIR}/memory.stat`]: 'anon 1000\ninactive_file 0\n', [`${DIR}/memory.swap.max`]: '0\n', [`${DIR}/memory.swap.current`]: '0\n', ...extra }[path];
  if (content === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
  return content;
};

test('host figures are capped at the container limit and its swap allowance', () => {
  const snapshot = { version: 2, path: DIR, limitBytes: LIMIT, currentBytes: 233 * MiB };
  const capped = capMemoryToCgroup({ availableMB: 10220, swapAvailableMB: 4095, snapshot, readFileSync: files() });
  assert.deepEqual(capped, { availableMB: Math.floor((LIMIT - 233 * MiB) / MiB), swapAvailableMB: 0, limitMB: 2990 });
});

test('reclaimable page cache counts as available, like docker stats', () => {
  const snapshot = { version: 2, path: DIR, limitBytes: 1024 * MiB, currentBytes: 900 * MiB };
  const capped = capMemoryToCgroup({ availableMB: 8000, swapAvailableMB: 0, snapshot, readFileSync: files({ [`${DIR}/memory.stat`]: `inactive_file ${500 * MiB}\n` }) });
  assert.equal(capped.availableMB, 624);
});

test('swap allowed by the cgroup and an unlimited swap.max', () => {
  const snapshot = { version: 2, path: DIR, limitBytes: 2048 * MiB, currentBytes: 0 };
  assert.equal(capMemoryToCgroup({ availableMB: 8000, swapAvailableMB: 4095, snapshot, readFileSync: files({ [`${DIR}/memory.swap.max`]: `${1024 * MiB}\n`, [`${DIR}/memory.swap.current`]: `${24 * MiB}\n` }) }).swapAvailableMB, 1000);
  assert.equal(capMemoryToCgroup({ availableMB: 8000, swapAvailableMB: 4095, snapshot, readFileSync: files({ [`${DIR}/memory.swap.max`]: 'max\n' }) }).swapAvailableMB, 4095);
});

test('the host figure wins when it is smaller than the container headroom', () => {
  const snapshot = { version: 2, path: DIR, limitBytes: 64 * 1024 * MiB, currentBytes: 0 };
  assert.equal(capMemoryToCgroup({ availableMB: 3000, swapAvailableMB: 0, snapshot, readFileSync: files() }).availableMB, 3000);
});

test('no cgroup limit leaves the host figures alone', () => {
  for (const snapshot of [null, {}, { version: 2, path: DIR, limitBytes: null }, { limitBytes: 0 }]) assert.equal(capMemoryToCgroup({ availableMB: 1, swapAvailableMB: 1, snapshot }), null);
});

test('cgroup v1 caps memory and keeps the host swap figure', () => {
  const snapshot = { version: 1, path: '/sys/fs/cgroup/memory', limitBytes: 1024 * MiB, currentBytes: 24 * MiB };
  assert.deepEqual(capMemoryToCgroup({ availableMB: 8000, swapAvailableMB: 10, snapshot, readFileSync: files() }), { availableMB: 1000, swapAvailableMB: 10, limitMB: 1024 });
});
