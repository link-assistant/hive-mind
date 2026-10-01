#!/usr/bin/env node
// Issue #2400: list the individual lines of a raw log that the publication
// sanitizer refuses to publish. Run it from a checkout of the version under test.
// Usage: node experiments/issue-2400-find-blocking-lines.mjs <file> [max]
import fs from 'node:fs/promises';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

const [file, max = '20'] = process.argv.slice(2);
const lines = (await fs.readFile(file, 'utf8')).split('\n');
let found = 0;
for (const [index, line] of lines.entries()) {
  try {
    await sanitizeForPublication(line);
  } catch (error) {
    found += 1;
    console.log(`line ${index + 1}: ${JSON.stringify(line.slice(0, 160))} -> ${error.cause?.message || error.message}${error.stage ? ` (stage: ${error.stage})` : ''}`);
    if (found >= Number(max)) break;
  }
}
console.log(`${found} blocking line(s) of ${lines.length}`);
