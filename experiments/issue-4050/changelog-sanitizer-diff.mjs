#!/usr/bin/env node
// Issue #4050: print every CHANGELOG.md line the publication sanitizer would change,
// with the exact differing span, so a masked release note can be traced to its rule.
// Usage: node experiments/issue-4050/changelog-sanitizer-diff.mjs [CHANGELOG.md]
import { readFileSync } from 'node:fs';
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';

const file = process.argv[2] ?? new URL('../../CHANGELOG.md', import.meta.url);
let changed = 0;
for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
  const output = await sanitizeForPublication(line, { includeEnvironmentCredentials: false });
  if (output === line) continue;
  changed++;
  let start = 0;
  while (start < line.length && line[start] === output[start]) start++;
  let end = 0;
  while (end < line.length - start && line[line.length - 1 - end] === output[output.length - 1 - end]) end++;
  console.log(`line ${index + 1}: ${JSON.stringify(line.slice(Math.max(0, start - 40), line.length - end + 20))}`);
  console.log(`   -> ${JSON.stringify(output.slice(Math.max(0, start - 40), output.length - end + 20))}`);
}
console.log(`${changed} line(s) changed`);
