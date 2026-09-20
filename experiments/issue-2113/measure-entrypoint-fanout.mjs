#!/usr/bin/env node

/**
 * Issue #2113: why does `fix --ci-cd` fail at dependency loading while the same
 * work split into `/task --ci-cd` + `/claude <issue>` succeeds?
 *
 * The race needs concurrent installs of one alias. Concurrency comes from the
 * module graph: Node evaluates sibling top-level-await subgraphs concurrently,
 * so every reachable module whose body starts with `await use('<pkg>')` is a
 * potential simultaneous `npm install -g <alias>` in a cold container.
 *
 * This script statically walks the import graph of each binary in package.json
 * and counts the reachable modules that top-level-await a use-m load. The count
 * is the upper bound on the simultaneous installs that entry point can trigger.
 *
 *   node experiments/issue-2113/measure-entrypoint-fanout.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// `import x from './y.mjs'` and `export * from './y.mjs'`: these edges are all
// linked and evaluated before the entry module's own body runs, so every
// top-level `await use(...)` behind them starts in the same wave.
const STATIC_IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s(?:[^'"()]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g;
// `await import('./y.mjs')` runs later, usually after some other module has
// already warmed the alias — it widens total reachability, not the cold burst.
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*['"](\.[^'"]+)['"]/g;
// Matches a module-scope `await use('pkg')` — the form that makes Node keep the
// importing module pending while npm runs.
const TOP_LEVEL_USE_PATTERN = /(?:^|\n)(?:const|let|var)\s[^;]*?await\s+use\(\s*['"]([^'"]+)['"]/g;

const readSource = async file => {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
};

const collect = async (entry, patterns, visited = new Map()) => {
  if (visited.has(entry)) return visited;
  const source = await readSource(entry);
  visited.set(entry, []);
  if (source === null) return visited;

  visited.set(
    entry,
    [...source.matchAll(TOP_LEVEL_USE_PATTERN)].map(match => match[1])
  );

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      await collect(path.resolve(path.dirname(entry), match[1]), patterns, visited);
    }
  }
  return visited;
};

const countCommandStreamLoaders = graph => [...graph.values()].filter(specifiers => specifiers.some(specifier => specifier.startsWith('command-stream'))).length;

const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const entries = Object.entries(packageJson.bin).map(([name, file]) => [name, path.resolve(repositoryRoot, file)]);

const rows = [];
for (const [name, entry] of entries) {
  const staticGraph = await collect(entry, [STATIC_IMPORT_PATTERN]);
  const fullGraph = await collect(entry, [STATIC_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]);
  rows.push({
    name,
    modules: fullGraph.size,
    coldBurst: countCommandStreamLoaders(staticGraph),
    reachable: countCommandStreamLoaders(fullGraph),
  });
}

const pad = (value, width) => String(value).padEnd(width);
process.stdout.write('command-stream loaders reachable from each binary\n\n');
process.stdout.write(`${pad('binary', 20)}${pad('modules', 10)}${pad('cold burst (static)', 22)}reachable (incl. dynamic)\n`);
for (const row of rows.sort((left, right) => right.coldBurst - left.coldBurst || right.reachable - left.reachable)) {
  process.stdout.write(`${pad(row.name, 20)}${pad(row.modules, 10)}${pad(row.coldBurst, 22)}${row.reachable}\n`);
}
