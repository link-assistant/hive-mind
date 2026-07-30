#!/usr/bin/env node
/**
 * Issue #2119: find `"${x}"` / `'${x}'` inside command-stream `$` templates.
 *
 * command-stream already shell-quotes every interpolated value, so a manual
 * quote around the placeholder leaks literal quotes into the argument whenever
 * the value needs quoting (i.e. contains a space). That is how the PR title
 * became `'Implement Hello World in Scala'`.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = ['src', 'scripts'];
const files = [];
const walk = async dir => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith('.mjs')) files.push(p);
  }
};
for (const r of roots) await walk(r);

// Match `$` followed by a backtick template, tolerating nested ${...} braces.
const TEMPLATE = /\$`(?:[^`\\]|\\.)*`/gs;
const QUOTED = /(["'])\$\{[^}]*\}\1/g;

let total = 0;
for (const file of files.sort()) {
  const src = await readFile(file, 'utf8');
  for (const m of src.matchAll(TEMPLATE)) {
    const hits = [...m[0].matchAll(QUOTED)];
    if (!hits.length) continue;
    const line = src.slice(0, m.index).split('\n').length;
    total += hits.length;
    console.log(`${file}:${line}  ${hits.map(h => h[0]).join(' ')}`);
    console.log(`    ${m[0].replace(/\s+/g, ' ').slice(0, 190)}`);
  }
}
console.log(`\n${total} quoted interpolation(s)`);
