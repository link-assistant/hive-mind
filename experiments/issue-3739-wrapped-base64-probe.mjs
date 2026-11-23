// Issue #3739: how @link-foundation/sensitive-data-sanitizer handles a base64
// blob wrapped across lines (synthetic token). Prints library findings and the
// library's own preserveEncoding output.
import { loadSensitiveDataSanitizer } from '../src/sensitive-data-sanitizer.lib.mjs';
const lib = loadSensitiveDataSanitizer();
const TOKEN = `gho_${'A'.repeat(12)}SYNTHETIC0000NotARealToken${'1'.repeat(10)}`.slice(0, 40);
const encoded = Buffer.from(JSON.stringify({ token: TOKEN, note: 'keep me' })).toString('base64');
const width = Number(process.argv[2] ?? 20);
const wrapped = encoded.replace(new RegExp(`(.{${width}})`, 'g'), '$1\n').replace(/\n$/, '');
const text = `start of output\nresponse body=\n${wrapped}\ntrailing line\n`;
const s = lib.createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true });
console.log(JSON.stringify(text));
for (const f of s.inspect(text)) console.log(f.rule, f.type, f.start, f.end, JSON.stringify(text.slice(f.start, f.end)));
let out;
try {
  out = s.sanitize(text);
} catch (e) {
  out = `${e.code}: ${e.message}`;
}
console.log(JSON.stringify(typeof out === 'string' ? out : (out.text ?? out)));
const leaked = wrapped.split('\n').filter(line => String(out?.text ?? out).includes(line));
console.log('raw wrapped lines still present:', leaked.length, 'of', wrapped.split('\n').length);
