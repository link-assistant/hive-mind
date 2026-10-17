// Check that a file goes through the publication sanitizer unchanged (issue #3445).
// Usage: node experiments/issue-3445-sanitize-file.mjs <file>
import { readFileSync } from 'node:fs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
const text = readFileSync(process.argv[2], 'utf8');
const output = await sanitizeForPublication(text, { includeEnvironmentCredentials: false });
const changed = text.split('\n').filter((line, index) => line !== output.split('\n')[index]);
console.log(changed.length === 0 ? 'unchanged' : `CHANGED:\n${changed.join('\n')}`);
process.exit(changed.length === 0 ? 0 : 1);
