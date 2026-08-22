import { createCredentialStreamSanitizer } from '../src/credential-sanitization-core.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
const T = 'gho_SYNTHETIC0000NotARealToken1111111111';
const wrap = (s, w) => s.replace(new RegExp(`(.{${w}})`, 'g'), '$1\n').replace(/\n$/, '');
const b64 = Buffer.from(JSON.stringify({ token: T, note: 'keep me' })).toString('base64');
const blob = wrap(b64, 20);
const text = `start of output\nresponse body=${blob}\ntrailing line\n`;
// simulate the on-disk log written by the stdio interceptor, one byte at a time
const s = createCredentialStreamSanitizer();
let logFile = '';
for (const ch of text) logFile += s.write(ch);
logFile += s.flush();
console.log('local log still holds wrapped blob:', logFile.includes(blob));
const published = await sanitizeForPublication(logFile);
console.log('after publication-boundary sanitize -> blob leak:', published.includes(blob));
console.log('after publication-boundary sanitize -> token leak:', published.includes(T));
