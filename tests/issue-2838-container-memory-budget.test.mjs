/**
 * @hive-mind-test-suite default
 * Issue #2838: inside docker isolation the memory preflight read the HOST `/proc/meminfo`.
 *
 * The container had `memory.max` = 2.92 GiB and `memory.swap.max` = 0, yet the preflight said
 * "11203MB available, swap: 4095MB", Claude (unlike Codex since #2745) got no memory budget in
 * its prompt and sized its builds from `free -g`, and `hive` started 2 workers in the one cgroup.
 * These tests pin the cgroup-aware preflight, the "System resources" summary, the per-tool
 * budget prompt and the hive `--concurrency` cap.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readCgroupMemory } from '../src/solve.resource-diagnostics.lib.mjs';
import { appendMemoryBudgetPrompt, applyHiveWorkerMemoryCap, buildMemoryBudgetPrompt, computeMemoryBudget, describeMemoryBudgetSource, evaluateWorkerMemoryBudget, formatCgroupMemorySummary } from '../src/memory-budget.lib.mjs';
import { buildCodexMemoryBudgetPrompt } from '../src/codex.process-exit.lib.mjs';
import { checkRAM } from '../src/memory-check.mjs';

const MiB = 1024 ** 2;
const LIMIT = 3_135_373_312; // 2.92 GiB, the incident containers' memory.max
const CURRENT = 1_556 * MiB;

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
  '/sys/fs/cgroup/memory.current': `${CURRENT}\n`,
  '/sys/fs/cgroup/memory.swap.max': '0\n',
  '/sys/fs/cgroup/memory.swap.current': '0\n',
  '/sys/fs/cgroup/memory.events': 'oom 0\noom_kill 0\n',
};
const CGROUP = readCgroupMemory(fakeReader(V2_FILES), 'linux');

// The host /proc/meminfo from the issue: ~11 GB available, 4 GB swap.
const HOST_MEMINFO = ['MemTotal:       12288000 kB', 'MemFree:         9000000 kB', 'Buffers:          200000 kB', 'Cached:          2000000 kB', 'SReclaimable:     272000 kB', 'SwapTotal:       4193280 kB', 'SwapFree:        4193280 kB', ''].join('\n');

test('cgroup v2 swap limit is read from memory.swap.max, cgroup v1 from memsw minus mem', () => {
  assert.equal(CGROUP.swapLimitBytes, 0);
  assert.equal(CGROUP.swapCurrentBytes, 0);
  assert.equal(readCgroupMemory(fakeReader({ ...V2_FILES, '/sys/fs/cgroup/memory.swap.max': 'max\n' }), 'linux').swapLimitBytes, null);

  const v1 = readCgroupMemory(
    fakeReader({
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': `${LIMIT}\n`,
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': '1000\n',
      '/sys/fs/cgroup/memory/memory.memsw.limit_in_bytes': `${LIMIT + 512 * MiB}\n`,
      '/sys/fs/cgroup/memory/memory.memsw.usage_in_bytes': '1500\n',
    }),
    'linux'
  );
  assert.equal(v1.limitBytes, LIMIT);
  assert.equal(v1.swapLimitBytes, 512 * MiB);
  assert.equal(v1.swapCurrentBytes, 500);
});

test('available memory is min(host available, memory.max - memory.current) and swap is 0 when the cgroup forbids it', () => {
  const budget = computeMemoryBudget({ hostAvailableBytes: 11_203 * MiB, hostSwapTotalBytes: 4_095 * MiB, hostSwapFreeBytes: 4_095 * MiB, cgroup: CGROUP });
  assert.equal(budget.source, 'cgroup');
  assert.equal(budget.availableBytes, LIMIT - CURRENT);
  assert.equal(budget.swapTotalBytes, 0);
  assert.equal(budget.swapFreeBytes, 0);

  // The host is the tighter bound when it has less than the cgroup headroom.
  assert.equal(computeMemoryBudget({ hostAvailableBytes: 100 * MiB, cgroup: CGROUP }).availableBytes, 100 * MiB);

  // No cgroup limit of its own: host values unchanged.
  const host = computeMemoryBudget({ hostAvailableBytes: 11_203 * MiB, hostSwapTotalBytes: 4_095 * MiB, hostSwapFreeBytes: 4_095 * MiB, cgroup: { ...CGROUP, limitBytes: null } });
  assert.equal(host.source, 'host');
  assert.equal(host.availableBytes, 11_203 * MiB);
  assert.equal(host.swapFreeBytes, 4_095 * MiB);
  assert.equal(describeMemoryBudgetSource(host), null);
});

test('the preflight reports the cgroup limit, not the host /proc/meminfo, and says which limit applied', async () => {
  const lines = [];
  const result = await checkRAM(256, { log: async line => lines.push(line), readMeminfo: async () => HOST_MEMINFO, readCgroupMemory: () => CGROUP });
  const headroomMB = Math.floor((LIMIT - CURRENT) / MiB);
  assert.equal(result.success, true);
  assert.equal(result.availableMB, headroomMB);
  assert.equal(result.totalAvailable, headroomMB, 'no host swap is counted');
  assert.equal(result.swap, 'none (container may not swap)');
  assert.equal(result.limitSource, 'cgroup');
  assert.equal(result.cgroupLimitMB, 2990);
  const text = lines.join('\n');
  assert.match(text, new RegExp(`🧠 Memory check: ${headroomMB}MB available, swap: none \\(container may not swap\\)`));
  assert.match(text, /Limit applied: container cgroup v2 memory\.max = 2990MB, 1556MB used; swap limited by memory\.swap\.max to 0MB \(\/sys\/fs\/cgroup\); host \/proc\/meminfo reports \d+MB available and 4095MB swap free, which does not apply here/);

  const failing = [];
  const failed = await checkRAM(4096, { log: async line => failing.push(line), readMeminfo: async () => HOST_MEMINFO, readCgroupMemory: () => CGROUP });
  assert.equal(failed.success, false);
  assert.match(failing.join('\n'), /container memory limit is exhausted/);
  assert.doesNotMatch(failing.join('\n'), /fallocate/, 'host swap advice does not help a container that may not swap');

  const outside = await checkRAM(256, { log: async () => {}, readMeminfo: async () => HOST_MEMINFO, readCgroupMemory: () => null });
  assert.equal(outside.limitSource, 'host');
  assert.equal(outside.swap, '4095MB (0MB used)');
  assert.equal(outside.availableMB, Math.floor((9_000_000 + 200_000 + 2_000_000 + 272_000) / 1024));
});

test('the "System resources" summary describes the cgroup instead of host MemFree', () => {
  assert.equal(formatCgroupMemorySummary(CGROUP), 'container cgroup v2 1.52 GiB used of 2.92 GiB memory.max, 1.40 GiB headroom, no swap (host MemFree does not apply)');
  assert.match(formatCgroupMemorySummary({ ...CGROUP, oomKills: 3 }), /OOM kills so far: 3/);
  assert.equal(formatCgroupMemorySummary({ ...CGROUP, limitBytes: null }), null);
  assert.equal(formatCgroupMemorySummary(null), null);
});

test('every tool gets the same memory-budget guidance, with the free/top warning and no shell-unsafe backticks', () => {
  const prompt = buildMemoryBudgetPrompt(CGROUP);
  assert.match(prompt, /container memory limit is 2\.92 GiB \(3135373312 bytes\)/);
  assert.match(prompt, /headroom is 1\.40 GiB/);
  assert.match(prompt, /There is no swap/);
  assert.match(prompt, /free, top, htop and \/proc\/meminfo show the HOST/);
  assert.match(prompt, /sequentially, never in the background alongside another build or alongside sub-agents/);
  assert.match(prompt, /CARGO_BUILD_JOBS=1/);
  // The Claude CLI path escapes only `"` and `$`; a backtick would run as command substitution.
  assert.doesNotMatch(prompt, /[`$]/);
  assert.equal(buildCodexMemoryBudgetPrompt(CGROUP), prompt, 'Codex (#2745) reuses the shared builder');

  assert.match(buildMemoryBudgetPrompt({ ...CGROUP, oomKills: 2 }), /OOM killer has already killed 2 process\(es\)/);
  assert.equal(buildMemoryBudgetPrompt({ ...CGROUP, limitBytes: null }), '');
  assert.equal(appendMemoryBudgetPrompt('Solve it.', null), 'Solve it.');
  assert.equal(appendMemoryBudgetPrompt('Solve it.', CGROUP), `Solve it.\n\n${prompt}`);
});

test('every tool appends the budget to its prompt', () => {
  for (const file of ['claude.lib.mjs', 'opencode.lib.mjs', 'gemini.lib.mjs', 'qwen.lib.mjs', 'agent.lib.mjs', 'agent-commander.lib.mjs']) {
    assert.match(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /appendMemoryBudgetPrompt\(/, file);
  }
  assert.match(readFileSync(new URL('../src/codex.lib.mjs', import.meta.url), 'utf8'), /buildCodexMemoryBudgetPrompt\(/);
});

test('hive caps --concurrency when memory.max / workers is below the per-worker minimum', async () => {
  assert.deepEqual(evaluateWorkerMemoryBudget({ concurrency: 2, cgroup: CGROUP }), { concurrency: 1, requested: 2, capped: true, perWorkerBytes: LIMIT / 2, limitBytes: LIMIT, minBytes: 2048 * MiB, belowMinimum: true });
  assert.equal(evaluateWorkerMemoryBudget({ concurrency: 2, cgroup: CGROUP, minMemoryPerWorkerMB: 1024 }).capped, false);
  assert.equal(evaluateWorkerMemoryBudget({ concurrency: 2, cgroup: CGROUP, minMemoryPerWorkerMB: 0 }).capped, false, '0 disables the cap');
  assert.equal(evaluateWorkerMemoryBudget({ concurrency: 4, cgroup: { ...CGROUP, limitBytes: null } }).concurrency, 4, 'no cgroup limit, no cap');
  // Even one worker below the minimum is kept (with a warning), never 0.
  assert.deepEqual((({ concurrency, capped, belowMinimum }) => ({ concurrency, capped, belowMinimum }))(evaluateWorkerMemoryBudget({ concurrency: 1, cgroup: CGROUP, minMemoryPerWorkerMB: 4096 })), { concurrency: 1, capped: false, belowMinimum: true });

  const lines = [];
  const argv = { concurrency: 2, minMemoryPerWorker: 2048 };
  await applyHiveWorkerMemoryCap({ argv, log: async line => lines.push(line), cgroup: CGROUP });
  assert.equal(argv.concurrency, 1);
  assert.match(lines.join('\n'), /Concurrency capped from 2 to 1: container memory limit 2\.92 GiB \/ 2 workers = 1\.46 GiB per worker, below --min-memory-per-worker 2048MB/);

  const kept = { concurrency: 2, minMemoryPerWorker: 0 };
  await applyHiveWorkerMemoryCap({ argv: kept, log: async () => assert.fail('no warning when disabled'), cgroup: CGROUP });
  assert.equal(kept.concurrency, 2);
});

test('hive accepts --min-memory-per-worker and does not forward it to solve', async () => {
  const { createYargsConfig, getSolvePassthroughOptionNames } = await import('../src/hive.config.lib.mjs');
  const { resolveYargsFactory } = await import('../src/yargs-factory.lib.mjs');
  const { ensureUseM } = await import('../src/use-m-bootstrap.lib.mjs');
  const use = await ensureUseM();
  const yargs = resolveYargsFactory(await use('yargs@17.7.2'));
  const parse = args =>
    createYargsConfig(yargs())
      .exitProcess(false)
      .fail((message, error) => {
        throw error || new Error(message);
      })
      .parse(args);
  assert.equal((await parse(['https://github.com/owner/repo'])).minMemoryPerWorker, 2048);
  assert.equal((await parse(['https://github.com/owner/repo', '--min-memory-per-worker', '0'])).minMemoryPerWorker, 0);
  assert.ok(!getSolvePassthroughOptionNames().includes('min-memory-per-worker'));
  assert.match(readFileSync(new URL('../src/hive.mjs', import.meta.url), 'utf8'), /applyHiveWorkerMemoryCap\(\{ argv, log \}\)/);
});
