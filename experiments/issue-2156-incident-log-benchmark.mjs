import { readFileSync } from 'node:fs';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
const text = readFileSync('/tmp/incident-2156.log', 'utf8');
console.log('bytes', text.length, 'lines', text.split('\n').length);
let t = Date.now();
const once = sanitizeCredentialText(text);
console.log('pass1 ms', Date.now() - t);
t = Date.now();
const twice = sanitizeCredentialText(once);
console.log('pass2 ms', Date.now() - t, 'idempotent', twice === once);
const a = text.split('\n'),
  b = once.split('\n');
let changed = 0;
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) changed++;
console.log('changed lines', changed, 'of', a.length);
console.log('line count preserved:', a.length === b.length);
