#!/usr/bin/env node
// Issue #3469: find tests asserting on `await import('./x.lib.mjs')` text that
// none of the src files the test reads contains any more (the Node 26
// static-import rewrite turned many of them into static imports).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
for (const f of readdirSync(join(root, 'tests'))) {
  if (!/\.m?js$/.test(f)) continue;
  const text = readFileSync(join(root, 'tests', f), 'utf8');
  const literals = [...text.matchAll(/["'`](await import\((['"])\.\/[^'"]+\2\))/g)].map(m => m[1]);
  if (!literals.length) continue;
  const srcFiles = [...new Set([...text.matchAll(/([\w.-]+\.mjs)/g)].map(m => m[1]))].filter(name => existsSync(join(root, 'src', name)));
  const srcText = srcFiles.map(name => readFileSync(join(root, 'src', name), 'utf8')).join('\n');
  for (const literal of literals) if (!srcText.includes(literal)) console.log(`${f}: ${literal} (reads ${srcFiles.join(', ')})`);
}
