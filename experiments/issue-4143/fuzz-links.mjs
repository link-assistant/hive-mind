// Round-trip random state trees through a real clink store (issue #4143).
// Usage: HIVE_MIND_CLINK=/path/to/clink node experiments/issue-4143/fuzz-links.mjs [seed] [runs]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLinksStore, decodeDoublets, encodeDoublets } from '../../src/bot-state-links.lib.mjs';
import { normalizeStringTree, stringTreesEqual } from '../../src/bot-state-lino.lib.mjs';
const alphabet = ['a', 'x', '0', ' ', '"', '(', ')', ':', '\n', '-', '_', '.', '~', 'é', '#'];
let seed = Number(process.argv[2] || 1);
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const str = () => Array.from({ length: Math.floor(rnd() * 4) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
const tree = depth => {
  const obj = {};
  for (let i = 0; i < 1 + Math.floor(rnd() * 4); i++) {
    const r = rnd();
    const key = str() || 'k' + i;
    if (depth < 3 && r < 0.3) obj[key] = tree(depth + 1);
    else if (r < 0.5) obj[key] = Array.from({ length: Math.floor(rnd() * 4) }, str);
    else obj[key] = rnd() < 0.2 ? key : str();
  }
  return obj;
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-links-'));
const store = createLinksStore({ dbPath: path.join(dir, 'state.links'), log: console.log });
let failures = 0;
const runs = Number(process.argv[3] || 50);
for (let i = 0; i < runs; i++) {
  const t = tree(0);
  const expected = normalizeStringTree(t) ?? {};
  await store.write(t);
  const got = await store.read();
  if (!stringTreesEqual(got, expected)) {
    failures++;
    if (failures < 3) console.log('MISMATCH', JSON.stringify(expected), encodeDoublets(t), JSON.stringify(got));
  }
}
fs.rmSync(dir, { recursive: true });
console.log(`runs=${runs} failures=${failures} decode-null=${decodeDoublets('') === null}`);
