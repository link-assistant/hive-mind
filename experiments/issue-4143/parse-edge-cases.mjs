// Edge cases of links-notation quoting inside an indented block (issue #4143).
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
if (typeof use === 'undefined') await ensureUseM();
const { useWithRetry } = await import('../../src/use-with-retry.lib.mjs');
const m = await useWithRetry(globalThis.use, 'links-notation');
const Parser = m.Parser || m.default?.Parser;
const p = new Parser();
const show = l => (l && typeof l === 'object' ? (l.values?.length ? [l.id, ...l.values.map(show)] : l.id) : l);
const samples = process.argv.length > 2 ? process.argv.slice(2) : ['root:\n  empty ""\n  next 1\n', 'root:\n  multi "line1\n  line2\nline3"\n  next 1\n', 'root:\n  q "say ""hi"""\n  next 1\n', "root:\n  q 'single'\n  next 1\n", 'root:\n  q `back`\n  next 1\n', "root:\n  q 'it''s'\n  next 1\n", 'root:\n  q """triple"""\n  next 1\n'];
for (const s of samples) {
  try {
    console.log(JSON.stringify(s), '=>', JSON.stringify(p.parse(s).map(show)));
  } catch (e) {
    console.log(JSON.stringify(s), '=> ERROR', e.message);
  }
}
