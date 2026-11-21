#!/usr/bin/env node
/**
 * Issue #3445: list every CHANGELOG.md line that the publication sanitizer
 * would change. Release notes are public documentation, so every change is
 * either a credential that was committed to CHANGELOG.md (none expected) or a
 * false positive that corrupts the published notes.
 *
 * Usage: node experiments/issue-3445-sanitizer-false-positives.mjs [CHANGELOG.md]
 */
import { readFileSync } from 'node:fs';

import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

const changelog = readFileSync(process.argv[2] || 'CHANGELOG.md', 'utf8');
let version = '';
let changed = 0;
for (const line of changelog.split('\n')) {
  if (line.startsWith('## ')) version = line.slice(3).trim();
  const output = await sanitizeForPublication(line, { includeEnvironmentCredentials: false });
  if (output !== line) {
    changed++;
    console.log(`${version}\n  - ${line.trim()}\n  + ${output.trim()}`);
  }
}
console.error(`${changed} changed line(s)`);
