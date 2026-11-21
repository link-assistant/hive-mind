// Find static/dynamic top-level import cycles that reach a target module (issue #3469 R3).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const [start, target] = process.argv.slice(2).map(p => resolve(p));
const re = /(?:^|\n)\s*(?:import\s[^'"]*?from\s*|(?:const|let)\s[^=]*=\s*await\s+import\(\s*|import\(\s*)['"](\.[^'"]+)['"]/g;
const deps = f => {
  const s = readFileSync(f, 'utf8');
  const out = [];
  for (const m of s.matchAll(re)) {
    const p = join(dirname(f), m[1]);
    if (existsSync(p)) out.push(p);
  }
  return out;
};
const seen = new Set();
const stack = [];
const dfs = f => {
  if (f === target && stack.length) {
    console.log([...stack, f].map(x => x.split('/src/')[1] || x).join(' -> '));
    return;
  }
  if (seen.has(f)) return;
  seen.add(f);
  stack.push(f);
  for (const d of deps(f)) dfs(d);
  stack.pop();
};
dfs(start);
