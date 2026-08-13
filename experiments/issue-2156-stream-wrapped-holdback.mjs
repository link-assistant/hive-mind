import { createCredentialStreamSanitizer, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
const T = 'gho_SYNTHETIC0000NotARealToken1111111111';
const wrap = (s, w) => s.replace(new RegExp(`(.{${w}})`, 'g'), '$1\n').replace(/\n$/, '');
const b64 = Buffer.from(JSON.stringify({ token: T, note: 'keep me' })).toString('base64');
let bad = 0;
for (const w of [20, 64, 76]) {
  for (const shape of ['own-line', 'inline-prefix']) {
    const blob = wrap(b64, w);
    const text = shape === 'own-line' ? `start of output\nresponse body=\n${blob}\ntrailing line\n` : `start of output\nresponse body=${blob}\ntrailing line\n`;
    const whole = sanitizeCredentialText(text);
    for (const chunk of [1, 5, 21, 1000]) {
      const s = createCredentialStreamSanitizer();
      let out = '';
      for (let i = 0; i < text.length; i += chunk) out += s.write(text.slice(i, i + chunk));
      out += s.flush();
      const ok = out === whole && !out.includes(T) && !out.includes(blob);
      if (!ok) bad++;
      console.log(`w=${w} ${shape} chunk=${chunk} sameAsWhole=${out === whole} blobLeak=${out.includes(blob)} tokenLeak=${out.includes(T)}`);
    }
  }
}
const s = createCredentialStreamSanitizer();
console.log('plain passthrough immediate:', s.write('hello world\n') === 'hello world\n');
const urlLine = s.write('see https://gist.github.com/konard/63a67ea16390b5f0c819e3d5ca749693\n');
const candidateUrl = urlLine.trim().split(/\s+/).find((part) => part.startsWith('http://') || part.startsWith('https://'));
let isExpectedHost = false;
if (candidateUrl) {
  try {
    isExpectedHost = new URL(candidateUrl).hostname === 'gist.github.com';
  } catch {
    isExpectedHost = false;
  }
}
console.log('url line immediate:', isExpectedHost);
console.log(bad === 0 ? 'ALL OK' : `FAILURES: ${bad}`);
