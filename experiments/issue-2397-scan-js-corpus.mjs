// Count files in a JS corpus whose sanitized form is not a fixed point of
// sanitizeCredentialText (=> sanitizeForPublication would block them), and
// print the offending line pairs (first few).
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
const roots = process.argv.slice(2);
const files = [];
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== '.git') walk(p);
    } else if (/\.(m?js|ts|json|md)$/.test(e.name) && fs.statSync(p).size < 1e6) files.push(p);
  }
};
roots.forEach(walk);
let bad = 0,
  shown = 0;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const s1 = sanitizeCredentialText(t);
  const s2 = sanitizeCredentialText(s1);
  if (s1 !== s2) {
    bad++;
    if (shown < Number(process.env.SHOW || 8)) {
      const a = s1.split('\n'),
        b = s2.split('\n');
      const i = a.findIndex((l, k) => l !== b[k]);
      console.log(f + ':' + (i + 1), '\n  pass1:', a[i].trim().slice(0, 160), '\n  pass2:', b[i].trim().slice(0, 160));
      shown++;
    }
  }
}
console.log(`files=${files.length} non-idempotent=${bad}`);
