#!/usr/bin/env node
// Issue #3469: turn the top-level `const ... = await import('./target')` lines that the
// TDZ scan reported into static imports (same bindings, no Node 26 TDZ).
// Usage: node experiments/static-imports-3469.mjs <scan.log>
// The log holds lines like `TDZ solve.watch.lib.mjs -> github.lib.mjs: ReferenceError ...`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const src = resolve('src');
const pairs = [...readFileSync(process.argv[2], 'utf8').matchAll(/^TDZ (\S+) -> ([^:]+):/gm)].map(m => [m[1], m[2]]);
const toSpecifiers = pattern =>
  pattern
    .slice(1, -1)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => part.replace(/^([\w$]+)\s*:\s*([\w$]+)$/, '$1 as $2'))
    .join(', ');
let changed = 0;
for (const [file, target] of pairs) {
  const path = join(src, file);
  const text = readFileSync(path, 'utf8');
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`^const\\s+(\\{[^}]*\\}|[\\w$]+)\\s*=\\s*await\\s+import\\(\\s*(['"])\\./${escaped}\\2\\s*\\);`, 'm');
  const next = text.replace(line, (_, binding, quote) => (binding.startsWith('{') ? `import { ${toSpecifiers(binding)} } from ${quote}./${target}${quote};` : `import * as ${binding} from ${quote}./${target}${quote};`));
  if (next === text) {
    console.log(`unchanged ${file} -> ${target}`);
    continue;
  }
  writeFileSync(path, next);
  changed++;
}
console.log(`${changed} import(s) made static`);
