/**
 * Compute the set of source files the long-lived Telegram bot process loads.
 *
 * Starting from an entry file, follow every relative static `import … from
 * './x.mjs'`, `export … from './x.mjs'` and literal dynamic `import('./x.mjs')`
 * until no new file appears. The result scopes the lint rules that only matter
 * inside the bot process (no synchronous I/O, no unbounded child processes),
 * so a module the bot starts importing is covered without editing a list.
 *
 * Only relative specifiers are followed; packages are not part of this
 * repository's code. Specifiers built at runtime cannot be resolved and are
 * skipped.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const SPECIFIER_PATTERNS = [
  // import x from './a.mjs'; import './a.mjs'; export { x } from './a.mjs'
  /(?:^|[\s;])(?:import|export)\s+(?:[^'"`;]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
  // await import('./a.mjs')
  /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
];

/**
 * Strip comments so a commented-out import is not followed.
 * Good enough for this repository's code; not a full tokenizer.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/**
 * @param {string} source
 * @returns {string[]} Relative specifiers found in the source.
 */
export function findRelativeSpecifiers(source) {
  const code = stripComments(source);
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of code.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

/**
 * @param {string} entryFile - Absolute path of the entry module.
 * @param {object} [options]
 * @param {string} [options.rootDir] - Paths in the result are relative to this directory.
 * @param {(path: string) => string|null} [options.readSource] - Injectable reader (tests).
 * @returns {string[]} Sorted paths (relative to `rootDir`, POSIX separators) of every reachable module, the entry included.
 */
export function computeImportClosure(entryFile, { rootDir = process.cwd(), readSource = defaultReadSource } = {}) {
  const seen = new Set();
  const queue = [resolve(entryFile)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const source = readSource(file);
    if (source === null) continue;
    seen.add(file);
    for (const specifier of findRelativeSpecifiers(source)) {
      const target = resolve(dirname(file), specifier);
      if (!seen.has(target)) queue.push(target);
    }
  }
  return [...seen].map(file => relative(rootDir, file).split('\\').join('/')).sort();
}

function defaultReadSource(file) {
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}
