// Issue #4143: how long a full import of a realistic bot state takes through
// createLinksStore (first write, or a rebuild after garbage), versus the
// 30 s clink timeout, then an incremental (--transactions) write of one
// changed task and a read. Usage:
//   HIVE_MIND_CLINK=/path/to/clink node experiments/issue-4143/clink-state-import-size.mjs [tasks...]
// HIVE_MIND_STATE_LINKS_INDEXED_LOOKUPS=off compares the default scan lookups.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { countLiveLinks, createLinksStore, encodeDoublets } from '../../src/bot-state-links.lib.mjs';
import { normalizeBotState, stateToStringTree } from '../../src/bot-state-store.lib.mjs';

const sizes = process.argv.slice(2).map(Number);
const task = i => ({ id: `task-${i}`, kind: 'solve', status: i % 3 ? 'queued' : 'running', url: `https://github.com/owner/repo/issues/${1000 + i}`, tool: 'claude', model: 'opus', chatId: String(-1000000 + i), messageId: String(5000 + i), requester: `user${i % 7}`, createdAt: new Date(1_800_000_000_000 + i * 1000).toISOString(), args: ['--model', 'opus', '--think', 'high'] });
for (const n of sizes.length ? sizes : [1, 5, 10, 20]) {
  const state = normalizeBotState({ instance: { pid: 123, startedAt: new Date().toISOString(), host: 'h' }, intake: { state: 'accepting' }, tasks: Object.fromEntries(Array.from({ length: n }, (_, i) => [`task-${i}`, task(i)])), subscribers: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(100 + i), { userId: String(100 + i), username: `u${i}`, subscribedAt: new Date().toISOString() }])) });
  const tree = stateToStringTree(state);
  const dir = mkdtempSync(path.join(tmpdir(), 'hm-size-'));
  const store = createLinksStore({ dbPath: path.join(dir, 's.links'), timeoutMs: 600000 });
  const started = Date.now();
  await store.write(tree);
  const ms = Date.now() - started;
  const ok = JSON.stringify(await store.read()) === JSON.stringify(tree);
  tree.tasks['task-0'].status = 'finished';
  let started2 = Date.now();
  await store.write(tree);
  const writeMs = Date.now() - started2;
  started2 = Date.now();
  const back = await store.read();
  const readMs = Date.now() - started2;
  const ok2 = JSON.stringify(back) === JSON.stringify(tree);
  console.log(`tasks=${n} doublet_lines=${encodeDoublets(tree).split('\n').filter(Boolean).length} live_links=${countLiveLinks(tree)} first_write_ms=${ms} read_ok=${ok} next_write_ms=${writeMs} read_ms=${readMs} read2_ok=${ok2}`);
  rmSync(dir, { recursive: true, force: true });
}
