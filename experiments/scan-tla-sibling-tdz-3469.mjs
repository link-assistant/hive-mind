#!/usr/bin/env node
// Issue #3469: find modules that break on Node 26 (V8 14.6) when a caller statically imports
// them together with a module they load through a top-level `await import()`.
// For every top-level `await import('./x')` in src/, write an entry that does
// `import 'module'; import './x';` and run it with the current node binary.
// Usage: node experiments/scan-tla-sibling-tdz-3469.mjs [nodeBin]
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const nodeBin = process.argv[2] || process.execPath;
const src = resolve('src');
const dir = mkdtempSync(join(tmpdir(), 'tla-scan-'));
const pairs = [];
for (const file of readdirSync(src).filter(f => f.endsWith('.mjs'))) {
  const text = readFileSync(join(src, file), 'utf8');
  for (const m of text.matchAll(/^(?:const|let)\s[^=\n]*=\s*await\s+import\(\s*['"]\.\/([^'"]+)['"]\s*\)/gm)) pairs.push([file, m[1]]);
}
let failures = 0;
for (const [file, target] of pairs) {
  const entry = join(dir, `${file}--${target.replace(/\//g, '_')}.mjs`);
  writeFileSync(entry, `import ${JSON.stringify(join(src, file))};\nimport ${JSON.stringify(join(src, target))};\n`);
  const run = spawnSync(nodeBin, [entry], { encoding: 'utf8', timeout: 60000, env: { ...process.env, HIVE_MIND_SKIP_STARTUP: '1' } });
  const out = `${run.stdout}${run.stderr}`;
  if (/before initialization/.test(out)) {
    failures++;
    console.log(`TDZ ${file} -> ${target}: ${out.match(/ReferenceError[^\n]*/)?.[0]}`);
  }
}
console.log(`${pairs.length} top-level dynamic imports checked with ${nodeBin}; ${failures} TDZ failure(s)`);
