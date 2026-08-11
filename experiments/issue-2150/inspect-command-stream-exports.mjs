#!/usr/bin/env node

/**
 * Inspect command-stream's public export shape for issue #2150.
 *
 * Usage:
 *   node experiments/issue-2150/inspect-command-stream-exports.mjs \
 *     /path/to/node_modules/command-stream/src/$.mjs
 */

import { pathToFileURL } from 'node:url';

const entryPath = process.argv[2];
if (!entryPath) {
  process.stderr.write('Usage: inspect-command-stream-exports.mjs <entry-path>\n');
  process.exitCode = 2;
} else {
  const module = await import(pathToFileURL(entryPath));
  const report = {
    entryPath,
    keys: Object.keys(module).sort(),
    namedDollarType: typeof module.$,
    defaultType: typeof module.default,
    defaultDollarType: typeof module.default?.$,
    defaultKeys: module.default ? Object.keys(module.default).sort() : [],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (typeof module.$ !== 'function') process.exitCode = 1;
}
