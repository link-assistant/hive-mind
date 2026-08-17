#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #2160, two defects in the `--auto-cleanup` path:
 *
 *  1. `src/hive.mjs` called `cleanupTempDirectories()` with no arguments in its non-`--once`
 *     branch. The function starts with `if (!argv || !argv.autoCleanup) return;`, so that call
 *     could never clean anything — a silent no-op that hid the missing cleanup from the log.
 *
 *  2. The cleanup itself ran `sudo rm -rf /tmp/* /var/tmp/*`, which also destroys the workspaces
 *     and log files of any *concurrent* hive/solve run on the same host. Cleanup now builds an
 *     explicit list and keeps anything a live process sits in, anything the caller protects, and
 *     the run's own log file.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { listCleanableTempEntries } from '../src/disk-guard.lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..');
const readSource = relativePath => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
  }
};

/**
 * A fake filesystem + /proc: `dirs` maps a directory to its entries, `cwds` maps a pid to the
 * directory that process is sitting in.
 */
const fakeSystem = ({ dirs = {}, cwds = {} }) => ({
  readdir: async dir => {
    if (dir === '/proc') return Object.keys(cwds);
    if (Object.prototype.hasOwnProperty.call(dirs, dir)) return dirs[dir];
    throw new Error(`ENOENT: ${dir}`);
  },
  readlink: async link => {
    const pid = link.split('/')[2];
    if (cwds[pid]) return cwds[pid];
    throw new Error(`ENOENT: ${link}`);
  },
  stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
});

await test('a workspace that a live process is sitting in is never removed', async () => {
  const fileSystem = fakeSystem({
    dirs: { '/tmp': ['gh-issue-solver-alive', 'gh-issue-solver-idle', 'unrelated-file'], '/var/tmp': [] },
    cwds: { 4242: '/tmp/gh-issue-solver-alive/src' },
  });
  const { remove, keep } = await listCleanableTempEntries({ fileSystem });
  assert.ok(!remove.includes('/tmp/gh-issue-solver-alive'), `a busy workspace must survive, got: ${remove.join(', ')}`);
  assert.deepStrictEqual(keep, [{ path: '/tmp/gh-issue-solver-alive', reason: 'process_cwd' }]);
  assert.deepStrictEqual(remove.sort(), ['/tmp/gh-issue-solver-idle', '/tmp/unrelated-file']);
});

await test('protected paths and the directory holding the active log file survive', async () => {
  const fileSystem = fakeSystem({
    dirs: { '/tmp': ['hive-mind-locks', 'hive-run.log', 'scratch'], '/var/tmp': ['stale'] },
    cwds: {},
  });
  const { remove, keep } = await listCleanableTempEntries({
    fileSystem,
    // A log file *inside* a temp entry must protect the whole entry, not just the file.
    protectedPaths: ['/tmp/hive-mind-locks/current', '/tmp/hive-run.log'],
  });
  assert.deepStrictEqual(keep.map(entry => entry.path).sort(), ['/tmp/hive-mind-locks', '/tmp/hive-run.log']);
  assert.ok(keep.every(entry => entry.reason === 'protected'));
  assert.deepStrictEqual(remove.sort(), ['/tmp/scratch', '/var/tmp/stale']);
});

await test('an unreadable /proc keeps everything instead of guessing', async () => {
  const fileSystem = fakeSystem({ dirs: { '/tmp': ['a', 'b'], '/var/tmp': [] } });
  fileSystem.readdir = async dir => {
    if (dir === '/proc') throw new Error('EACCES');
    if (dir === '/tmp') return ['a', 'b'];
    return [];
  };
  const { remove, keep } = await listCleanableTempEntries({ fileSystem });
  assert.deepStrictEqual(remove, [], 'without /proc there is no way to tell what is in use — delete nothing');
  assert.deepStrictEqual(
    keep.map(entry => entry.reason),
    ['process_cwd', 'process_cwd']
  );
});

await test('a missing temp root is skipped rather than failing the cleanup', async () => {
  const { remove } = await listCleanableTempEntries({
    roots: ['/tmp', '/var/tmp'],
    fileSystem: fakeSystem({ dirs: { '/tmp': ['only-here'] }, cwds: { 1: '/' } }),
  });
  assert.deepStrictEqual(remove, ['/tmp/only-here']);
});

await test('hive.mjs forwards argv to every cleanupTempDirectories call', () => {
  const source = readSource('src/hive.mjs');
  const calls = source.match(/await cleanupTempDirectories\([^)]*\)/g) || [];
  assert.ok(calls.length >= 2, `expected both cleanup call sites, found ${calls.length}`);
  for (const call of calls) {
    assert.strictEqual(call, 'await cleanupTempDirectories(argv)', `cleanupTempDirectories returns immediately without argv, so "${call}" would be a silent no-op`);
  }
});

await test('cleanupTempDirectories no longer globs whole temp roots', () => {
  const source = readSource('src/lib.mjs');
  // Only the executed command matters — the historical glob is still quoted in the doc comment.
  const commands = source.match(/\$`[^`]*`/g) || [];
  for (const command of commands) {
    assert.ok(!/rm -rf\s+\/(tmp|var)\b/.test(command), `deleting a whole temp root wipes concurrent runs: ${command}`);
  }
  assert.ok(
    commands.some(command => /sudo rm -rf \$\{remove\}/.test(command)),
    'the cleanup must remove exactly the enumerated list of paths'
  );
  assert.match(source, /listCleanableTempEntries/, 'cleanup must go through the enumerating helper');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
