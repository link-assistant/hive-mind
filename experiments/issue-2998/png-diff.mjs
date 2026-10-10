// Compare two same-sized PNGs: how many pixels differ and by how much (max channel delta).
// Usage: node experiments/issue-2998/png-diff.mjs a.png b.png
import { readFile } from 'node:fs/promises';
import { decodePng } from '../../src/gif-frames.lib.mjs';

const [a, b] = await Promise.all(process.argv.slice(2, 4).map(async file => decodePng(await readFile(file))));
const histogram = new Map();
let box = null;
for (let i = 0; i < a.width * a.height; i++) {
  const delta = Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c])));
  if (!delta) continue;
  const bucket = Math.min(64, 2 ** Math.ceil(Math.log2(delta)));
  histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
  const [x, y] = [i % a.width, Math.floor(i / a.width)];
  if (delta >= 8) box = box ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) } : { left: x, top: y, right: x, bottom: y };
}
console.log('pixels by max channel delta (<=):', Object.fromEntries([...histogram].sort((p, q) => p[0] - q[0])));
console.log('box of deltas >= 8:', box);
