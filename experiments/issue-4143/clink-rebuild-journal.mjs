// Issue #4143: with link-cli >= 3.2 the transactions journal (<db>.transitions.log)
// outlives a store rebuild (data files deleted, tree re-imported). Check that the
// rebuilt store holds only the live tree, and that the journal stays bounded.
// Usage: HIVE_MIND_CLINK=/path/to/clink node experiments/issue-4143/clink-rebuild-journal.mjs [writes]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createLinksStore, parseDoubletsExport, countLiveLinks } from '../../src/bot-state-links.lib.mjs';
const clink = process.env.HIVE_MIND_CLINK || 'clink';
console.log(execFileSync(clink, ['--version']).toString().trim());
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-rebuild-'));
const dbPath = path.join(dir, 'state.links');
const logs = [];
const store = createLinksStore({ dbPath, log: m => logs.push(m) });
const writes = Number(process.argv[2] || 200);
const sizes = () => Object.fromEntries(fs.readdirSync(dir).map(f => [f, fs.statSync(path.join(dir, f)).size]));
let rebuilds = 0;
let maxJournal = 0;
let worst = 0;
let worstAt = 0;
const times = [];
for (let i = 1; i <= writes; i++) {
  const tree = { instance: { heartbeat: String(Date.now() + i), pid: String(1000 + (i % 7)) }, tasks: { [`q-${i}`]: { url: `https://example.test/${i}`, args: ['--model', 'opus', `#${i}`] } } };
  const before = logs.length;
  const started = Date.now();
  await store.write(tree);
  const took = Date.now() - started;
  times.push(took);
  if (took > worst) [worst, worstAt] = [took, i];
  const rebuilt = logs.slice(before).some(m => m.startsWith('Rebuilding'));
  if (rebuilt) {
    rebuilds++;
    const out = path.join(dir, 'check.lino');
    execFileSync(clink, ['--db', dbPath, '--out', out]);
    const total = parseDoubletsExport(fs.readFileSync(out, 'utf8')).size;
    fs.rmSync(out);
    const live = countLiveLinks(tree);
    const read = await store.read();
    const ok = JSON.stringify(read) === JSON.stringify(tree);
    console.log(`write ${i}: rebuilt, links after rebuild=${total} live=${live} read_ok=${ok} files=${JSON.stringify(sizes())}`);
  }
  maxJournal = Math.max(maxJournal, sizes()['state.transitions.log'] || 0);
}
const sorted = [...times].sort((a, b) => a - b);
const pct = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
console.log(
  `write ms: p50=${pct(0.5)} p95=${pct(0.95)} max=${worst} at write ${worstAt}; over 1s: ${
    times
      .map((t, k) => (t > 1000 ? `#${k + 1}=${t}` : ''))
      .filter(Boolean)
      .join(' ') || 'none'
  }`
);
console.log(`writes=${writes} rebuilds=${rebuilds} max_journal_bytes=${maxJournal} slowest_write_ms=${worst} final=${JSON.stringify(sizes())}`);
fs.rmSync(dir, { recursive: true, force: true });
