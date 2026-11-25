// Shows how links-notation parses the indented shapes used by the bot state file.
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
if (typeof use === 'undefined') await ensureUseM();
const { useWithRetry } = await import('../../src/use-with-retry.lib.mjs');
const m = await useWithRetry(globalThis.use, 'links-notation');
const Parser = m.Parser || m.default?.Parser;
const p = new Parser();
const show = l => (l && typeof l === 'object' ? { id: l.id, values: (l.values || []).map(show) } : l);
const samples = [
  'root:\n  args:\n    --verbose\n    "5"\n    "a b"\n  "12345":\n    name "x"\n  empty ""\n  multi "line1\n  line2\nline3"\n  q "say ""hi"""\n',
  'root:\n  a 1\n  b:\n    c 2\n  d "x:y"\n',
];
for (const s of samples) console.log(JSON.stringify(p.parse(s).map(show), null, 1));
