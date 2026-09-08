#!/usr/bin/env node

/**
 * Issue #2186 — reclaiming orphaned agent snapshot stores from Hive Mind's side.
 *
 * The version floor in `test-issue-2186-agent-snapshot-leak.mjs` stops Hive Mind
 * from *creating* new leaks by refusing agent CLIs older than 0.26.1. This file
 * covers the other half of the issue's proposed fix — the part Hive Mind owns:
 *
 *   A. reclaim agent state when a task finishes, keyed on the worktree recorded
 *      in `storage/project/<id>.json` being gone;
 *   B. do it unconditionally, not only under `--auto-cleanup`, because an
 *      orphaned store has nothing left to restore into;
 *   C. teach the disk model about agent state — the disk guard, `hive-cleanup`
 *      and the resource snapshots all used to look only at `/tmp`.
 *
 * Everything here runs against real directories in a throwaway temp root, with
 * only the clock and the free-space probe faked, so the classification rules are
 * exercised the way they will run in production.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2186
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert as check, printSummary, getFailCount } from './test-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const { AGENT_DATA_DIR_NAME, classifyAgentSnapshotStores, DEFAULT_AGENT_SNAPSHOT_MIN_IDLE_MS, describeAgentSnapshotReason, getAgentDataHome, listAgentSnapshotStores, measureAgentSnapshotUsage, readAgentProjectWorktree, reclaimAgentSnapshotStores } = await import('../src/agent-snapshot-store.lib.mjs');
const { ensureDiskSpaceForWorker } = await import('../src/disk-guard.lib.mjs');
const { buildResourceMarker, formatResourceSnapshotForLog, parseResourceMarkers, recordResourceSnapshot } = await import('../src/solve.resource-diagnostics.lib.mjs');

const NOW = 1_800_000_000_000;
const MINUTE = 60 * 1000;

/**
 * Build an agent data home on disk: one store per `stores` entry, with the
 * project record and worktree the entry asks for.
 *
 * @param {Array<{id: string, ageMinutes?: number, worktree?: 'alive'|'gone'|null, bytes?: number}>} stores
 */
const makeAgentDataHome = stores => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2186-'));
  const dataHome = path.join(root, '.local', 'share', AGENT_DATA_DIR_NAME);
  fs.mkdirSync(path.join(dataHome, 'snapshot'), { recursive: true });
  fs.mkdirSync(path.join(dataHome, 'storage', 'project'), { recursive: true });
  for (const store of stores) {
    const storePath = path.join(dataHome, 'snapshot', store.id);
    fs.mkdirSync(path.join(storePath, 'objects'), { recursive: true });
    fs.writeFileSync(path.join(storePath, 'objects', 'pack'), 'x'.repeat(store.bytes ?? 8));
    if (store.worktree) {
      const worktree = path.join(root, 'worktrees', store.id);
      if (store.worktree === 'alive') fs.mkdirSync(worktree, { recursive: true });
      fs.writeFileSync(path.join(dataHome, 'storage', 'project', `${store.id}.json`), JSON.stringify({ worktree, id: store.id }));
    }
    // Age the store itself; the fixture writes files into it first so the
    // directory mtime would otherwise always be "now".
    const mtime = new Date(NOW - (store.ageMinutes ?? 60) * MINUTE);
    fs.utimesSync(storePath, mtime, mtime);
  }
  return { root, dataHome };
};

const removeTree = root => fs.rmSync(root, { recursive: true, force: true });

const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push(name);
  } catch (error) {
    check(false, `${name}: ${error.message}`);
  }
};

// ---------------------------------------------------------------------------
// 1. Where the agent state lives
// ---------------------------------------------------------------------------

check(getAgentDataHome({ env: { XDG_DATA_HOME: '/data' }, homeDir: () => '/home/x' }) === path.join('/data', AGENT_DATA_DIR_NAME), 'the agent data home follows XDG_DATA_HOME when it is set');
check(getAgentDataHome({ env: {}, homeDir: () => '/home/x' }) === path.join('/home/x', '.local', 'share', AGENT_DATA_DIR_NAME), 'the agent data home falls back to ~/.local/share, the path issue #2186 reported');
check(DEFAULT_AGENT_SNAPSHOT_MIN_IDLE_MS === 15 * 60 * 1000, "the idle window matches agent's own recentSnapshotAge (15 minutes)");
check((await listAgentSnapshotStores({ dataHome: path.join(os.tmpdir(), 'issue-2186-does-not-exist') })).length === 0, 'a missing agent data home lists no stores instead of throwing');

// ---------------------------------------------------------------------------
// 2. Classification: only a dead worktree plus an idle store is garbage
// ---------------------------------------------------------------------------

await test('classification keeps live worktrees and reclaims idle orphans', async () => {
  const { root, dataHome } = makeAgentDataHome([
    { id: 'alive', worktree: 'alive', ageMinutes: 120 },
    { id: 'orphan-gone', worktree: 'gone', ageMinutes: 120 },
    { id: 'orphan-no-record', worktree: null, ageMinutes: 120 },
    { id: 'fresh', worktree: 'gone', ageMinutes: 1 },
  ]);
  try {
    const { orphaned, keep } = await classifyAgentSnapshotStores({ dataHome, now: () => NOW });
    const reasonById = Object.fromEntries([...orphaned, ...keep].map(store => [store.id, store.reason]));
    check(reasonById.alive === 'worktree_alive', 'a store whose worktree still exists is kept');
    check(reasonById['orphan-gone'] === 'worktree_gone', 'a store whose recorded worktree is gone is an orphan');
    check(reasonById['orphan-no-record'] === 'no_project_record', 'an idle store with no project record is an orphan');
    check(reasonById.fresh === 'recently_modified', 'a store modified inside the idle window is kept even without a worktree');
    check(orphaned.length === 2 && keep.length === 2, `exactly the two orphans are selected (got ${orphaned.length} orphaned, ${keep.length} kept)`);
    check((await readAgentProjectWorktree({ dataHome, projectId: 'alive' })) !== null, 'the recorded worktree is read back from storage/project/<id>.json');
    check((await readAgentProjectWorktree({ dataHome, projectId: 'orphan-no-record' })) === null, 'a missing project record reads back as null, not an error');
  } finally {
    removeTree(root);
  }
});

check(describeAgentSnapshotReason('worktree_gone') === 'recorded worktree no longer exists', 'reasons render in English for --dry-run output');
check(describeAgentSnapshotReason('something_new') === 'something_new', 'an unknown reason falls back to itself instead of undefined');

// ---------------------------------------------------------------------------
// 3. Reclamation deletes exactly the orphans
// ---------------------------------------------------------------------------

await test('reclaimAgentSnapshotStores deletes orphans and leaves live stores alone', async () => {
  const { root, dataHome } = makeAgentDataHome([
    { id: 'alive', worktree: 'alive', ageMinutes: 120 },
    { id: 'orphan-a', worktree: 'gone', ageMinutes: 120 },
    { id: 'orphan-b', worktree: 'gone', ageMinutes: 120 },
  ]);
  try {
    const { removed, skipped } = await reclaimAgentSnapshotStores({ dataHome, now: () => NOW });
    check(removed.length === 2, `both orphans are removed (removed ${removed.length})`);
    check(!fs.existsSync(path.join(dataHome, 'snapshot', 'orphan-a')) && !fs.existsSync(path.join(dataHome, 'snapshot', 'orphan-b')), 'the orphaned stores are gone from disk');
    check(fs.existsSync(path.join(dataHome, 'snapshot', 'alive')), 'the store belonging to a live worktree survives');
    check(
      skipped.some(entry => entry.reason === 'worktree_alive'),
      'the surviving store is reported with its reason'
    );
  } finally {
    removeTree(root);
  }
});

await test('reclamation stops as soon as enough space is free', async () => {
  const { root, dataHome } = makeAgentDataHome([
    { id: 'orphan-a', worktree: 'gone', ageMinutes: 120 },
    { id: 'orphan-b', worktree: 'gone', ageMinutes: 120 },
    { id: 'orphan-c', worktree: 'gone', ageMinutes: 120 },
  ]);
  try {
    let freeMB = 100;
    const { removed } = await reclaimAgentSnapshotStores({
      dataHome,
      now: () => NOW,
      stopWhenFreeMB: 500,
      getFreeMB: async () => {
        const current = freeMB;
        freeMB += 400; // one store is enough
        return current;
      },
    });
    check(removed.length === 1, `reclamation stops at the first store that satisfies the requirement (removed ${removed.length})`);
    check(fs.readdirSync(path.join(dataHome, 'snapshot')).length === 2, 'the remaining orphans are left for a later, hungrier run');
  } finally {
    removeTree(root);
  }
});

// ---------------------------------------------------------------------------
// 4. The disk guard reclaims agent state before solver workspaces (proposal C)
// ---------------------------------------------------------------------------

await test('ensureDiskSpaceForWorker reclaims orphaned agent stores when disk is low', async () => {
  const { root, dataHome } = makeAgentDataHome([
    { id: 'orphan', worktree: 'gone', ageMinutes: 120 },
    { id: 'alive', worktree: 'alive', ageMinutes: 120 },
  ]);
  const tmpRoot = path.join(root, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  try {
    let freeMB = 1000;
    const result = await ensureDiskSpaceForWorker({
      requiredMB: 5000,
      tmpRoot,
      agentDataHome: dataHome,
      now: () => NOW,
      procRoot: path.join(root, 'no-proc'),
      getFreeMB: async () => freeMB,
      remove: async target => {
        fs.rmSync(target, { recursive: true, force: true });
        freeMB = 9000;
      },
    });
    check(result.ok === true && result.reason === 'reclaimed', `the guard reports the space as reclaimed (ok=${result.ok}, reason=${result.reason})`);
    check(result.reclaimed.includes(path.join(dataHome, 'snapshot', 'orphan')), 'the orphaned agent store is what the guard reclaimed');
    check(fs.existsSync(path.join(dataHome, 'snapshot', 'alive')), 'the guard never touches a store whose worktree is still checked out');
  } finally {
    removeTree(root);
  }
});

await test('the disk guard can be pointed away from agent state entirely', async () => {
  const { root } = makeAgentDataHome([{ id: 'orphan', worktree: 'gone', ageMinutes: 120 }]);
  const tmpRoot = path.join(root, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  try {
    const result = await ensureDiskSpaceForWorker({ requiredMB: 100, tmpRoot, agentDataHome: null, getFreeMB: async () => 9000 });
    check(result.ok === true && result.reason === 'sufficient', 'agentDataHome: null keeps the previous behaviour when there is enough space');
  } finally {
    removeTree(root);
  }
});

// ---------------------------------------------------------------------------
// 5. Resource snapshots name the directory that is filling up (proposal C)
// ---------------------------------------------------------------------------

await test('measureAgentSnapshotUsage sizes the stores it can see', async () => {
  const { root, dataHome } = makeAgentDataHome([
    { id: 'a', worktree: 'gone', ageMinutes: 120, bytes: 1000 },
    { id: 'b', worktree: 'alive', ageMinutes: 120, bytes: 2000 },
  ]);
  try {
    const usage = await measureAgentSnapshotUsage({ dataHome });
    check(usage.count === 2, `both stores are counted (got ${usage.count})`);
    check(usage.bytes >= 3000, `the reported size covers both stores (got ${usage.bytes})`);
    check(usage.truncated === false, 'a small tree is measured completely');
    const capped = await measureAgentSnapshotUsage({ dataHome, entryLimit: 1 });
    check(capped.truncated === true, 'the walk stops at the entry limit instead of scanning tens of gigabytes in a logging call');
    check((await measureAgentSnapshotUsage({ dataHome: path.join(root, 'missing') })).count === 0, 'a missing agent data home measures as empty');
  } finally {
    removeTree(root);
  }
});

await test('agent state reaches the resource snapshot log line and the marker', async () => {
  const snapshot = {
    phase: 'after_agent',
    timestamp: '2026-09-04T00:00:00.000Z',
    cpu: { load1: 1, load5: 1, load15: 1, cpuCount: 4 },
    memory: { totalBytes: 8 * 1024 ** 3, availableBytes: 4 * 1024 ** 3, usedBytes: 4 * 1024 ** 3, processRssBytes: 1024 ** 2, processHeapUsedBytes: 1024 ** 2, processHeapTotalBytes: 2 * 1024 ** 2, processExternalBytes: 0, processHeapLimitBytes: 4 * 1024 ** 3, processHeapUsedPercent: 1 },
    disk: { path: '/', totalBytes: 100 * 1024 ** 3, freeBytes: 60 * 1024 ** 3, availableBytes: 60 * 1024 ** 3, usedBytes: 40 * 1024 ** 3, usedPercent: 40, error: null },
    agentState: { path: '/home/hive/.local/share/link-assistant-agent', count: 115, bytes: 31 * 1024 ** 3, truncated: false },
  };
  const text = formatResourceSnapshotForLog(snapshot);
  check(text.includes('115 store(s)') && text.includes('31.0 GB'), 'the log block reports the store count and size the issue measured');
  check(text.includes('/home/hive/.local/share/link-assistant-agent'), 'the log block names the directory, not just the mount point');

  const parsed = parseResourceMarkers(buildResourceMarker(snapshot));
  check(parsed.markers[0].agentState?.count === 115, 'the marker round-trips the store count for the session monitor');
  check(parsed.markers[0].agentState?.bytes === 31 * 1024 ** 3, 'the marker round-trips the measured size');

  const withoutAgentState = { ...snapshot, agentState: null };
  check(!buildResourceMarker(withoutAgentState).includes('agentState'), 'markers stay byte-compatible when there is no agent state to report');
  check(parseResourceMarkers(buildResourceMarker(withoutAgentState)).markers[0].agentState === null, 'an older marker parses with a null agent state');
});

await test('recordResourceSnapshot survives an unreadable agent data home', async () => {
  const lines = [];
  const snapshot = await recordResourceSnapshot({
    phase: 'after_agent',
    log: async message => lines.push(message),
    measureAgentState: async () => {
      throw new Error('permission denied');
    },
  });
  check(snapshot !== null, 'a failing agent-state probe does not cost us the resource snapshot');
  check(lines.join('\n').includes('📈 Resource usage'), 'the usual resource block is still logged');
});

// ---------------------------------------------------------------------------
// 6. Wiring: unconditional on task completion, reportable from hive-cleanup
// ---------------------------------------------------------------------------

// Issue #2187 moved the success-path cleanup helpers out of
// solve.repository.lib.mjs, which re-exports them, into their own module to
// stay under the 1350-line warning threshold (#1593).
const cleanupLib = fs.readFileSync(path.join(repoRoot, 'src', 'solve.cleanup.lib.mjs'), 'utf8');
check(/export const cleanupAgentSnapshotStores/.test(cleanupLib), 'solve exposes an agent-snapshot cleanup step');
check(/await cleanupAgentSnapshotStores\(\);/.test(cleanupLib), 'the cleanup step is invoked from cleanupTempDirectory');
const repositoryLib = fs.readFileSync(path.join(repoRoot, 'src', 'solve.repository.lib.mjs'), 'utf8');
check(/export \{[^}]*cleanupTempDirectory[^}]*\} from '\.\/solve\.cleanup\.lib\.mjs';/.test(repositoryLib), 'the cleanup steps are still reachable from solve.repository.lib.mjs');
const cleanupTail = cleanupLib.slice(cleanupLib.indexOf('export const cleanupTempDirectory'));
const keepBranchIndex = cleanupTail.indexOf('await cleanupAgentSnapshotStores();');
// The branch that decides whether the workspace survives is `shouldKeepDirectory`;
// the reclamation has to come after it, not inside it.
check(keepBranchIndex > cleanupTail.indexOf('shouldKeepDirectory') && cleanupTail.indexOf('shouldKeepDirectory') >= 0, 'agent snapshots are reclaimed after the keep/delete decision, i.e. regardless of --auto-cleanup (proposal B)');

const cleanupCli = fs.readFileSync(path.join(repoRoot, 'src', 'cleanup.mjs'), 'utf8');
check(/--no-agent-snapshots/.test(cleanupCli), 'hive-cleanup documents an opt-out for the new category');
check(/classifyAgentSnapshotStores/.test(cleanupCli), 'hive-cleanup reports what it would remove using the same classification');
check(/Agent snapshot stores/.test(cleanupCli), 'hive-cleanup prints a labelled section for agent state');

for (const name of results) console.log(`✅ ${name}`);
console.log('\nIssue #2186 — agent snapshot reclamation');
printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
