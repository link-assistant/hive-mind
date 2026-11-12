// Probe: can library redact() render Hive-adjusted findings, and does
// preserveEncoding re-encode base64 payloads in place (issue #2156 parity)?
import { createSyncSanitizer, redact } from '@link-foundation/sensitive-data-sanitizer';
const R = 'Q7wZ2kLp9XvB4nTr6YcM1sHd8FgJ3aEu';
const pe = createSyncSanitizer({ credentialsOnly: true, transformation: { mode: 'hive-mask' }, preserveEncoding: true });
const b64 = Buffer.from(JSON.stringify({ user: 'octocat', access_token: 'gho_' + R, scope: 'repo' })).toString('base64');
for (const t of [`body ${b64} end`, `x=${encodeURIComponent('password=' + R)}`, `hex ${Buffer.from('password=' + R).toString('hex')} end`]) {
  try {
    const out = pe.sanitize(t).text;
    const m = out.match(/[A-Za-z0-9+/=%]{20,}/);
    console.log(
      JSON.stringify(out),
      m
        ? '\n   decoded:' +
            (() => {
              try {
                return Buffer.from(m[0], 'base64').toString();
              } catch {
                return '?';
              }
            })()
        : ''
    );
  } catch (e) {
    console.log('ERR', e.code, e.message);
  }
}
const plain = createSyncSanitizer({ credentialsOnly: true });
const t = `Authorization: token ${R}`;
const f = plain.inspect(t);
console.log(f);
const adjusted = f.map(x => ({ ...x, start: x.start + (t.slice(x.start, x.end).match(/^[A-Za-z][\w-]*[ \t]+/)?.[0].length ?? 0) }));
try {
  console.log(redact(t, adjusted, { credentialsOnly: true, transformation: { mode: 'hive-mask' } }));
} catch (e) {
  console.log('ERR', e.code, e.message);
}
