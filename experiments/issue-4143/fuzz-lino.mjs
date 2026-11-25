// Fuzz the bot-state LiNo codec: random trees must round-trip (issue #4143).
import { formatLinoTree, parseLinoTree, normalizeStringTree, stringTreesEqual, loadLinoParser } from '../../src/bot-state-lino.lib.mjs';
const parser = await loadLinoParser();
const alphabet = ['a', 'Z', '0', '9', ' ', '"', "'", '`', '(', ')', ':', '\n', '\t', '-', '_', '.', '/', '\\', '~', 'é', '😀', '#', '=', ',', '\r', '\u0001'];
let seed = Number(process.argv[2] || 1);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const str = () => Array.from({ length: Math.floor(rnd() * 8) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
const tree = depth => {
  const obj = {};
  const n = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    const key = str() || 'k' + i;
    if (depth < 3 && r < 0.3) obj[key] = tree(depth + 1);
    else if (r < 0.5) obj[key] = Array.from({ length: Math.floor(rnd() * 4) }, str);
    else obj[key] = str();
  }
  return obj;
};
let failures = 0;
const runs = Number(process.argv[3] || 500);
for (let i = 0; i < runs; i++) {
  const t = tree(0);
  const text = formatLinoTree(t);
  let parsed;
  try { parsed = (await parseLinoTree(text, { parser })).tree; } catch (e) { parsed = e.message; }
  const expected = normalizeStringTree(t) ?? {};
  if (!stringTreesEqual(parsed, expected)) {
    failures++;
    if (failures < 4) console.log('MISMATCH', JSON.stringify(expected), '\n', text, '\n', JSON.stringify(parsed));
  }
}
console.log(`runs=${runs} failures=${failures}`);
