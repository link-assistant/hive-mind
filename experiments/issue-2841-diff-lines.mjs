#!/usr/bin/env node
// Issue #2841: show which lines of a file the publication sanitizer rewrites.
// Usage: node experiments/issue-2841-diff-lines.mjs <file>
import fs from 'node:fs/promises';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { findCredentialRuleIds } from '../src/credential-sanitization-core.lib.mjs';
const text = await fs.readFile(process.argv[2], 'utf8');
const out = await sanitizeForPublication(text);
const a = text.split('\n');
const b = out.split('\n');
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  if (a[i] !== b[i]) console.log(`${i + 1}: [${findCredentialRuleIds(a[i]).join(',')}]\n  - ${a[i]}\n  + ${b[i]}`);
}
