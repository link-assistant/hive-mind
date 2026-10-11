// Issue #2890: check links-notation@0.25.1 round-trips arbitrary strings.
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
await ensureUseM();
const { useWithRetry } = await import('../src/use-with-retry.lib.mjs');
const m = await useWithRetry(globalThis.use, 'links-notation@0.25.1');
const { Parser, Link, formatLinks } = m;
const samples = ['plain', "it's", 'say "hi"', `mix ' and "`, 'a`b', 'with space', 'paren (x)', 'colon: y', 'line1\nline2', 'tab\tx', 'https://github.com/a/b/issues/1', '--model', '', '((', '"\'`', 'é ünïcode 🚀', '#', '//comment', '123', ' lead', 'trail ', '\\', 'a\\nb'];
let fail = 0;
for (const s of samples) {
  const doc = [new Link('item', [new Link('k', []), new Link(s, [])])];
  const text = formatLinks(doc);
  let back;
  try {
    back = new Parser().parse(text);
  } catch (e) {
    console.log('PARSE ERR', JSON.stringify(s), text, e.message);
    fail++;
    continue;
  }
  const got = back[0]?.values?.[1]?.id;
  const ok = got === s && back[0].id === 'item';
  if (!ok) {
    fail++;
    console.log('MISMATCH', JSON.stringify(s), '=>', JSON.stringify(text), '=>', JSON.stringify(got));
  }
}
console.log('fail', fail, 'of', samples.length);
