#!/usr/bin/env node
// Issue #2400: stream a real session log through the publication sanitizer,
// block by block, and report every block that is blocked and why.
// Usage: node experiments/issue-2400-sanitize-log.mjs <log-file>
import { forEachLogBlock } from '../src/log-sanitize-stream.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

const file = process.argv[2] || 'docs/case-studies/issue-2400/original-log.txt';
let index = 0;
let blocked = 0;
let offset = 0;
await forEachLogBlock(file, async text => {
  index += 1;
  try {
    await sanitizeForPublication(text);
  } catch (error) {
    blocked += 1;
    const extra = ['stage', 'findings', 'cause']
      .map(key => (error[key] ? `${key}=${JSON.stringify(error[key]?.message || error[key])}` : ''))
      .filter(Boolean)
      .join(' ');
    console.log(`block ${index} @char ${offset} (${text.length} chars): ${error.message} ${extra}`);
  }
  offset += text.length;
});
console.log(`${index} block(s), ${blocked} blocked`);
