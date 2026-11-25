// Issue #4143 upstream reproduction. Run from a directory with links-notation@0.31.8 (and lino-objects-codec@1.1.0) installed.
import { Parser } from 'links-notation';
const p = new Parser();
const show = l => (l && typeof l === 'object' ? (l.values?.length ? [l.id, ...l.values.map(show)] : l.id) : l);
for (const t of ['root:\n  a ""\n  b ""\n', "root:\n  a ''\n  b ''\n", 'root:\n  a ""\n  b "x y"\n', 'root:\n  tag #release\n  next 1\n', 'root:\n  time 12:30\n', 'root:\n  url https://x/y#frag\n'])
  try {
    console.log(JSON.stringify(t), '=>', JSON.stringify(p.parse(t).map(show)));
  } catch (e) {
    console.log(JSON.stringify(t), 'ERROR', e.message.split('\n')[0]);
  }
