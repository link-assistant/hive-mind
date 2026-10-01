#!/usr/bin/env node
// Issue #2400: which repository files block a log upload when the AI session
// reads them? Each file is encoded the way a tool result appears in the
// stream-JSON session log (JSON.stringify), masked once the way `log()` masks
// every message, then passed through the fail-closed publication sanitizer.
// Run it from the checkout whose sanitizer you want to test:
//   node experiments/issue-2400-scan-repo-files.mjs <repo-root> [--raw] [path-prefix...]
// --raw scans the file text as-is (as `cat` output mirrored to the console)
// instead of its JSON-escaped tool-result form.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

const [root = '.', ...rest] = process.argv.slice(2);
const raw = rest.includes('--raw');
const prefixes = rest.filter(arg => arg !== '--raw');
const files = execFileSync('git', ['-C', root, 'ls-files', ...(prefixes.length ? prefixes : ['src', 'tests', 'experiments', 'scripts'])], { encoding: 'utf8' })
  .split('\n')
  .filter(file => /\.(m?js|cjs|json|md|sh|txt)$/.test(file));
let blocked = 0;
for (const file of files) {
  const content = await fs.readFile(path.join(root, file), 'utf8').catch(() => null);
  if (content === null) continue;
  const logLine = sanitizeCredentialText(raw ? content : JSON.stringify({ type: 'tool_result', content }));
  try {
    await sanitizeForPublication(logLine);
  } catch (error) {
    blocked += 1;
    console.log(`${file}: ${error.cause?.message || error.message}${error.stage ? ` (stage: ${error.stage}; findings: ${JSON.stringify(error.findings)})` : ''}`);
  }
}
console.log(`${blocked} of ${files.length} file(s) block publication`);
