// Compares the library's sanitize() with inspect() + redact() (the path Hive
// Mind's policy needs) for the cases where they might differ. Synthetic data.
import { Buffer } from 'node:buffer';
import { createSyncSanitizer, redact } from '@link-foundation/sensitive-data-sanitizer';

const OPTIONS = { credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } };
const s = createSyncSanitizer(OPTIONS);
const GH = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');
const attempt = fn => {
  try {
    return fn();
  } catch (error) {
    return `throws ${error.code}`;
  }
};
const short = v => (typeof v === 'string' && v.length > 160 ? `${JSON.stringify(v.slice(0, 80))}…(${v.length})…${JSON.stringify(v.slice(-60))}` : JSON.stringify(v));
const compare = (label, text) => {
  const viaSanitize = attempt(() => s.sanitize(text).text);
  const findings = attempt(() => s.inspect(text));
  const viaRedact = typeof findings === 'string' ? findings : attempt(() => redact(text, findings, OPTIONS));
  console.log(`${label}\n  sanitize():         ${short(viaSanitize)}\n  inspect()+redact(): ${short(viaRedact)}${typeof findings === 'string' ? '' : `  [${findings.map(f => f.rule).join(',')}]`}`);
};

const ids = n => Array.from({ length: n }, (_, i) => `id_${String(i).padStart(4, '0')}abcdefghijklmnop`);
compare('5000 identifiers, one line', `${ids(5000).join(' ')} token: ${GH}`);
compare('5000 identifiers, one per line', `${ids(5000).join('\n')}\ntoken: ${GH}`);
compare(
  '5000 identifiers, prose between',
  `${ids(5000)
    .map(id => `item ${id} done`)
    .join('\n')}\ntoken: ${GH}`
);
const hex = Buffer.from(['Plain', 'TextPass', 'word1'].join('')).toString('hex');
compare('short hex value', `password=${hex} and the rest`);
const secret = 'Pk7Rm2Qx9LwZaB8y';
const known = createSyncSanitizer({ ...OPTIONS, knownSecrets: [secret] });
const text = `x ${Buffer.from(secret).toString('hex')} y`;
console.log('hex of a 16-character known secret');
console.log(`  sanitize():         ${short(attempt(() => known.sanitize(text).text))}`);
const kf = known.inspect(text);
console.log(`  inspect()+redact(): ${short(attempt(() => redact(text, kf, { ...OPTIONS, knownSecrets: [secret] })))}  [${kf.map(f => `${f.rule}:${f.type}`).join(',')}]`);
const doc = JSON.stringify({ note: 'x'.repeat(60), token: GH, more: 'y'.repeat(60) });
const wrapped = Buffer.from(doc)
  .toString('base64')
  .match(/.{1,40}/g)
  .join('\n');
compare('base64 wrapped at 40 columns', wrapped);
