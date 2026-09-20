import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
const T = 'gho_SYNTHETIC0000NotARealToken1111111111';
let bad = 0,
  n = 0;
for (const note of ['keep me', 'x', 'a longer note here to shift lengths', 'ab', 'abc', 'abcd', 'abcde']) {
  const payload = Buffer.from(JSON.stringify({ token: T, note })).toString('base64');
  for (const w of [20, 24, 32, 40, 64, 76]) {
    const w2 = payload.replace(new RegExp(`(.{${w}})`, 'g'), '$1\n').replace(/\n$/, '');
    if (!w2.includes('\n')) continue;
    for (const after of ['tail', 'done', 'OK', 'trailing line', 'x', '']) {
      for (const prefix of ['body=', 'x', 'abcdef', '']) {
        const text = `${prefix}\n${w2}\n${after ? after + '\n' : ''}`;
        const out = sanitizeCredentialText(text);
        const masked = !out.includes(w2) && !out.includes(T);
        const kept = !after || out.includes(after);
        n++;
        if (!masked || !kept) {
          bad++;
          console.log(`FAIL note=${JSON.stringify(note)} w=${w} pre=${JSON.stringify(prefix)} after=${JSON.stringify(after)} masked=${masked} kept=${kept}`);
        }
      }
    }
  }
}
console.log(bad === 0 ? `ALL OK (${n} cases)` : `${bad}/${n} failures`);
