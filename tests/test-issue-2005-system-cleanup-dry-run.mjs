#!/usr/bin/env node
/**
 * Regression tests for issue #2005.
 *
 * `hive-cleanup --dry-run` must report estimated reclaimable bytes for
 * opt-in system cleanup categories and must await async logging so the final
 * footer cannot interleave with system-cleanup lines.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2005
 */

import assert from 'node:assert/strict';

import { runSystemCleanup } from '../src/cleanup.os.lib.mjs';
import { parseDockerSystemDf, parseAptAutoremoveFreedBytes, parseJournalDiskUsageBytes } from '../src/system-cleanup-estimates.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

function makeProbe(outputs) {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    return Object.hasOwn(outputs, key) ? outputs[key] : null;
  };
}

await test('parseDockerSystemDf sums reclaimable bytes from docker system df', () => {
  const parsed = parseDockerSystemDf(`TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          4         2         12.4GB    3.2GB (25%)
Containers      2         0         212B      212B (100%)
Local Volumes   1         1         1.5GB     0B (0%)
Build Cache     8         0         42.1MB    42.1MB`);

  assert.equal(parsed.totalReclaimableBytes, Math.round(3.2 * 1024 ** 3) + 212 + Math.round(42.1 * 1024 ** 2));
  assert.deepEqual(
    parsed.items.map(item => item.type),
    ['Images', 'Containers', 'Local Volumes', 'Build Cache']
  );
});

await test('parseAptAutoremoveFreedBytes reads apt simulation output', () => {
  assert.equal(parseAptAutoremoveFreedBytes('After this operation, 181 MB disk space will be freed.'), 181 * 1024 ** 2);
  assert.equal(parseAptAutoremoveFreedBytes('0 upgraded, 0 newly installed, 0 to remove and 12 not upgraded.'), 0);
  assert.equal(parseAptAutoremoveFreedBytes('After this operation, 2,048 kB disk space will be freed.'), 2048 * 1024);
});

await test('parseJournalDiskUsageBytes reads journalctl disk usage output', () => {
  assert.equal(parseJournalDiskUsageBytes('Archived and active journals take up 1.6G in the file system.'), Math.round(1.6 * 1024 ** 3));
});

await test('dry-run logs per-command estimates and a reclaim total', async () => {
  const logs = [];
  const results = await runSystemCleanup({
    apt: true,
    journal: true,
    docker: true,
    npm: true,
    dryRun: true,
    now: new Date('2026-07-02T00:00:00.000Z'),
    journalFiles: [
      { path: '/var/log/journal/old/system.journal', size: 3 * 1024 ** 3, mtimeMs: new Date('2026-06-01T00:00:00.000Z').getTime() },
      { path: '/var/log/journal/recent/system.journal', size: 512 * 1024 ** 2, mtimeMs: new Date('2026-07-01T00:00:00.000Z').getTime() },
    ],
    execFn: makeProbe({
      'du -sb /var/cache/apt/archives': `${100 * 1024 ** 2}\t/var/cache/apt/archives`,
      'apt-get -s autoremove': 'After this operation, 250 MB disk space will be freed.',
      'journalctl --disk-usage': 'Archived and active journals take up 3.5G in the file system.',
      'docker system df': `TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          1         0         800MB     300MB (37%)
Build Cache     2         0         50MB      20MB`,
      'npm config get cache': '/tmp/npm-cache',
      'du -sb /tmp/npm-cache': `${25 * 1024 ** 2}\t/tmp/npm-cache`,
    }),
    logFn: message => logs.push(message),
  });

  assert.ok(logs.some(line => line.includes('apt-get clean') && line.includes('100M')));
  assert.ok(logs.some(line => line.includes('apt-get autoremove -y') && line.includes('250M')));
  assert.ok(logs.some(line => line.includes('journalctl --vacuum-time=2weeks') && line.includes('3G')));
  assert.ok(logs.some(line => line.includes('docker system prune -f') && line.includes('320M')));
  assert.ok(logs.some(line => line.includes('npm cache clean --force') && line.includes('25M')));
  assert.ok(logs.some(line => line.includes('estimated system reclaim') && line.includes('3.7G')));

  const byCommand = new Map(results.map(result => [result.command, result]));
  assert.equal(byCommand.get('apt-get clean').estimatedBytes, 100 * 1024 ** 2);
  assert.equal(byCommand.get('apt-get autoremove -y').estimatedBytes, 250 * 1024 ** 2);
  assert.equal(byCommand.get('journalctl --vacuum-time=2weeks').estimatedBytes, 3 * 1024 ** 3);
  assert.equal(byCommand.get('docker system prune -f').estimatedBytes, 320 * 1024 ** 2);
  assert.equal(byCommand.get('npm cache clean --force').estimatedBytes, 25 * 1024 ** 2);
});

await test('runSystemCleanup awaits async logFn calls before resolving', async () => {
  const logs = [];
  await runSystemCleanup({
    docker: true,
    dryRun: true,
    execFn: makeProbe({
      'docker system df': `TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Build Cache     1         0         12MB      12MB`,
    }),
    logFn: message =>
      new Promise(resolve => {
        setImmediate(() => {
          logs.push(message);
          resolve();
        });
      }),
  });
  logs.push('footer');

  assert.equal(logs.at(-1), 'footer');
  assert.ok(logs.slice(0, -1).some(line => line.includes('docker system prune -f')));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
