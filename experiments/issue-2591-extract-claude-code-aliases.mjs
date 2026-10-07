#!/usr/bin/env node
// Issue #2591: extract the model alias tables baked into a Claude Code binary.
// Usage: node experiments/issue-2591-extract-claude-code-aliases.mjs <path-to-claude-binary>
import fs from 'node:fs';

const binaryPath = process.argv[2];
if (!binaryPath) {
  console.error('usage: issue-2591-extract-claude-code-aliases.mjs <claude-binary>');
  process.exit(1);
}
const text = fs.readFileSync(binaryPath).toString('latin1');
const excerpt = (needle, before, after) => {
  const index = text.indexOf(needle);
  return index === -1 ? '(not found)' : text.slice(Math.max(0, index - before), index + needle.length + after);
};
console.log(`# Model alias excerpts from ${binaryPath}`);
console.log('\n## Alias list accepted by --model');
console.log(excerpt('_2=["sonnet"', 0, 140));
console.log('\n## Known first-party model IDs');
console.log(excerpt('"claude-sonnet-5-5"],_2=', 420, 0));
console.log('\n## Alias defaults (aliases / best / latest_per_family)');
console.log(excerpt('latest_per_family:{', 700, 120));
