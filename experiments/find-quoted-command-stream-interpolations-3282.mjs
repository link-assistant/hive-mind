// Issue #3282: list command-stream templates ($`...` / $({...})`...`) that wrap an
// interpolation in "..." or '...' — command-stream already quotes values, so the
// extra quotes make its quoting literal and re-enable shell expansion.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as acorn from 'acorn';
const dir = process.argv[2] || 'src';
const visit = (node, fn) => {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach(c => visit(c, fn));
    else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, fn);
  }
};
const isDollar = tag => (tag.type === 'Identifier' && tag.name === '$') || (tag.type === 'CallExpression' && tag.callee.type === 'Identifier' && tag.callee.name === '$');
for (const file of readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
  const code = readFileSync(join(dir, file), 'utf8');
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch {
    continue;
  }
  visit(ast, node => {
    if (node.type !== 'TaggedTemplateExpression' || !isDollar(node.tag)) return;
    const q = node.quasi.quasis;
    for (let i = 0; i < q.length - 1; i++) {
      const before = q[i].value.raw,
        after = q[i + 1].value.raw;
      const m = before.match(/(["'])$/);
      if (m && after.startsWith(m[1])) console.log(`${dir}/${file}:${node.quasi.expressions[i].loc.start.line} ${m[1]}\${${code.slice(node.quasi.expressions[i].start, node.quasi.expressions[i].end)}}${m[1]}`);
    }
  });
}
