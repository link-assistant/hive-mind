// Lists the src modules a module statically imports, transitively (issue #2888 cycle check).
import fs from 'node:fs';
import path from 'node:path';
const seen = new Set();
const walk = file => {
  if (seen.has(file)) return;
  seen.add(file);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/^import [^;]*?from '(\.\/[^']+)'/gms)) walk(path.resolve(path.dirname(file), m[1]));
};
walk(path.resolve(process.argv[2]));
const target = process.argv[3];
console.log(seen.size, 'modules;', target, [...seen].some(f => f.endsWith(target)) ? 'IS in the graph' : 'is NOT in the graph');
