import { createCredentialStreamSanitizer, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
const T = 'gho_SYNTHETIC0000NotARealToken1111111111';
const wrap = (s, w) => s.replace(new RegExp(`(.{${w}})`, 'g'), '$1\n').replace(/\n$/, '');
const b64 = Buffer.from(JSON.stringify({ token: T, note: 'keep me' })).toString('base64');
// Two separate claims, reported separately: nothing leaks, and the stream
// result matches whole-text sanitization. The second is the stronger one and
// only became true once the *opening* line of a blob was held back as well.
// Before that, a line like `body=<first segment>` was released on its own
// whenever it completed before its continuation arrived, and the group that
// followed was sanitized without it — so a credential straddling the first fold
// was in neither piece and the blob passed through intact.
//
// Note the leak check decodes what was released rather than trusting the
// absence of the literal token: the released pieces are still base64.
let leaks = 0;
let differs = 0;
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
      // Released pieces are still base64, so decode them back before believing
      // the absence of the literal token. Folds are rejoined first and every
      // offset within a run is tried, because the run an attacker reads starts
      // wherever the label ends, not at a multiple of three bytes.
      const unfolded = out.replace(/\n/g, '');
      const recoverable = (unfolded.match(/[A-Za-z0-9+/=]{24,}/g) ?? []).some(run => Array.from({ length: Math.max(0, run.length - 24) }, (_, alignment) => alignment).some(alignment => Buffer.from(run.slice(alignment), 'base64').toString('utf8').includes(T)));
      const leaked = out.includes(T) || unfolded.includes(blob.replace(/\n/g, '')) || recoverable;
      if (leaked) leaks++;
      if (out !== whole) differs++;
      console.log(`w=${w} ${shape} chunk=${chunk} sameAsWhole=${out === whole} leak=${leaked}`);
    }
  }
}
const s = createCredentialStreamSanitizer();
console.log('plain passthrough immediate:', s.write('hello world\n') === 'hello world\n');
const urlLine = s.write('see https://gist.github.com/konard/63a67ea16390b5f0c819e3d5ca749693\n');
const candidateUrl = urlLine
  .trim()
  .split(/\s+/)
  .find(part => part.startsWith('http://') || part.startsWith('https://'));
let isExpectedHost = false;
if (candidateUrl) {
  try {
    isExpectedHost = new URL(candidateUrl).hostname === 'gist.github.com';
  } catch {
    isExpectedHost = false;
  }
}
console.log('url line immediate:', isExpectedHost);
console.log(`\n${differs} of 24 cases differ from whole-text sanitization (expected 0)`);
console.log(leaks === 0 ? 'NO LEAKS' : `LEAKS: ${leaks}`);
