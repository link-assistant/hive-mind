#!/usr/bin/env node

/**
 * Issue #2186 — see the orphaned agent snapshot stores, then watch them go.
 *
 * Builds a throwaway `$XDG_DATA_HOME/link-assistant-agent` that looks like the
 * host in the incident report — some stores whose worktree is still checked out,
 * some whose worktree is long gone — reports what Hive Mind would reclaim, and
 * then reclaims it.
 *
 * Usage: node examples/agent-snapshot-reclaim-demo.mjs
 */

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { classifyAgentSnapshotStores, describeAgentSnapshotReason, measureAgentSnapshotUsage, reclaimAgentSnapshotStores } from '../src/agent-snapshot-store.lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-snapshot-demo-'));
const dataHome = path.join(root, '.local', 'share', 'link-assistant-agent');
const now = Date.now();
const HOUR = 60 * 60 * 1000;

const fixture = [
  { id: 'live-task', worktree: 'alive', ageHours: 2, sizeKB: 256 },
  { id: 'finished-task-1', worktree: 'gone', ageHours: 5, sizeKB: 512 },
  { id: 'finished-task-2', worktree: 'gone', ageHours: 9, sizeKB: 512 },
  { id: 'crashed-task', worktree: null, ageHours: 30, sizeKB: 512 },
  { id: 'just-started', worktree: null, ageHours: 0, sizeKB: 64 },
];

fs.mkdirSync(path.join(dataHome, 'snapshot'), { recursive: true });
fs.mkdirSync(path.join(dataHome, 'storage', 'project'), { recursive: true });
for (const store of fixture) {
  const storePath = path.join(dataHome, 'snapshot', store.id);
  fs.mkdirSync(path.join(storePath, 'objects', 'pack'), { recursive: true });
  fs.writeFileSync(path.join(storePath, 'objects', 'pack', 'pack-demo.pack'), Buffer.alloc(store.sizeKB * 1024, 1));
  if (store.worktree) {
    const worktree = path.join(root, 'worktrees', store.id);
    if (store.worktree === 'alive') fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(dataHome, 'storage', 'project', `${store.id}.json`), JSON.stringify({ id: store.id, worktree }));
  }
  const mtime = new Date(now - store.ageHours * HOUR);
  fs.utimesSync(storePath, mtime, mtime);
}

const before = await measureAgentSnapshotUsage({ dataHome });
console.log(`📦 ${dataHome}`);
console.log(`   ${before.count} store(s), ${(before.bytes / 1024 ** 2).toFixed(1)} MB\n`);

const { orphaned, keep } = await classifyAgentSnapshotStores({ dataHome });
console.log('KEPT:');
for (const store of keep) console.log(`   ${store.id.padEnd(18)} ${describeAgentSnapshotReason(store.reason)}`);
console.log('WOULD REMOVE:');
for (const store of orphaned) console.log(`   ${store.id.padEnd(18)} ${describeAgentSnapshotReason(store.reason)}`);

const { removed } = await reclaimAgentSnapshotStores({ dataHome });
const after = await measureAgentSnapshotUsage({ dataHome });
console.log(`\n🧹 Reclaimed ${removed.length} store(s); ${after.count} left, ${(after.bytes / 1024 ** 2).toFixed(1)} MB\n`);

fs.rmSync(root, { recursive: true, force: true });
