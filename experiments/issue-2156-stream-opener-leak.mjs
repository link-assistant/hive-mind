// Measures the leak that the first version of the line-wrap fix left behind, and
// that `wrappedBase64OpenerStart` in `src/encoded-credential-detection.lib.mjs`
// closes.
//
// The shape is a base64 blob that begins on the same line as its label —
// `response body=<first segment>` — which is what a JSON response body looks
// like once a tool folds it. That line is not base64-only, so it never joins the
// held-back group of base64 lines; released on its own, it is sanitized alone,
// and the group that follows is sanitized without it. A credential straddling
// the first fold is then in neither half: the opening line decodes to a token
// truncated below the rule's length, and the group decodes to a body with no
// `gho_` prefix left to match.
//
// Sweeps the credential across all 24 of its offsets relative to the fold, at
// three chunk sizes, for the two fold widths that matter in practice (64 for
// PEM, 76 for MIME). Expected output with the fix in place:
//
//   width 64: 0 of 72 leaking
//   width 76: 0 of 72 leaking
//
// To see the defect, make `wrappedBase64OpenerStart` return `null` before the
// alignment loop and run again; that prints 28 of 72 and 10 of 72.
//
// Checking for the literal token would not be enough here: what is released is
// still base64. The check below rejoins the folds first — exactly as a reader of
// the log would — and then decodes from every offset within each run, because
// the run starts where the label ends rather than at a three-byte boundary.
import { createCredentialStreamSanitizer } from '../src/credential-sanitization-core.lib.mjs';

const TOKEN = 'gho_SYNTHETIC0000NotARealToken1111111111';
const CHUNKS = [1, 7, 4096];

const recoverable = output => {
  const unfolded = output.replace(/\n/g, '');
  for (const run of unfolded.match(/[A-Za-z0-9+/=]{24,}/g) ?? []) {
    for (let alignment = 0; alignment < run.length - 24; alignment++) {
      if (Buffer.from(run.slice(alignment), 'base64').toString('utf8').includes(TOKEN)) return true;
    }
  }
  return false;
};

for (const width of [64, 76]) {
  const leaking = [];
  let total = 0;
  for (let pad = 0; pad < 24; pad++) {
    const payload = JSON.stringify({ pad: 'p'.repeat(pad), token: TOKEN, note: 'keep me' });
    const blob = Buffer.from(payload)
      .toString('base64')
      .replace(new RegExp(`(.{${width}})`, 'g'), '$1\n')
      .replace(/\n$/, '');
    const text = `start of output\nresponse body=${blob}\ntrailing line\n`;
    for (const chunk of CHUNKS) {
      const stream = createCredentialStreamSanitizer();
      let output = '';
      for (let offset = 0; offset < text.length; offset += chunk) output += stream.write(text.slice(offset, offset + chunk));
      output += stream.flush();
      total++;
      if (output.includes(TOKEN) || output.replace(/\n/g, '').includes(blob.replace(/\n/g, '')) || recoverable(output)) leaking.push(`pad=${pad} chunk=${chunk}`);
    }
  }
  console.log(`width ${width}: ${leaking.length} of ${total} leaking${leaking.length ? ` — ${leaking.slice(0, 8).join(', ')}${leaking.length > 8 ? ', …' : ''}` : ''}`);
}
