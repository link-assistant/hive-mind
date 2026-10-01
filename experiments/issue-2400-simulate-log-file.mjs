#!/usr/bin/env node
// Issue #2400: simulate how solve writes its log file. `log()` masks every
// message with sanitizeCredentialText and prefixes "[timestamp] [INFO]"; the
// upload later runs the fail-closed publication sanitizer over that file.
// Usage: node experiments/issue-2400-simulate-log-file.mjs <raw-input> <out-log>
import fs from 'node:fs/promises';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';

const [input, output] = process.argv.slice(2);
const raw = await fs.readFile(input, 'utf8');
const stamp = '[2026-10-01T15:03:50.000Z] [INFO]';
const masked = sanitizeCredentialText(raw)
  .split('\n')
  .map(line => `${stamp} ${line}`)
  .join('\n');
await fs.writeFile(output, `${masked}\n`);
console.log(`wrote ${output}`);
