// Candidate fix check: copy the core sanitizer into a temp module with the
// assignment separator changed from `(?:=>|[:=])` to `(?:=>|[:=](?!>))`, then
// re-run the reproducers and the corpus idempotency scan against it.
import fs from 'node:fs';
import path from 'node:path';
const srcDir = new URL('../src/', import.meta.url).pathname;
const tmp = '/tmp/issue-2397/patched-src';
fs.mkdirSync(tmp, { recursive: true });
for (const f of ['credential-sanitization-core.lib.mjs', 'encoded-credential-detection.lib.mjs']) fs.copyFileSync(path.join(srcDir, f), path.join(tmp, f));
const corePath = path.join(tmp, 'credential-sanitization-core.lib.mjs');
let code = fs.readFileSync(corePath, 'utf8');
const before = code;
code = code.replace(/(const (?:QUOTED|UNQUOTED)_ASSIGNMENT = new RegExp\(`[^\n]*?)\(\?:=>\|\[:=\]\)/g, '$1(?:=>|[:=](?!>))');
if (code === before) throw new Error('patch did not apply');
fs.writeFileSync(corePath, code);
const { sanitizeCredentialText } = await import(corePath);
const cases = ['secret=>LH5qO6yo', 'const f = token => !token;', '.filter(token => token.type !== "Shebang")', "{ 'password' => 'hunter2' }", ':token => "abc"', 'password=hunter2', 'token => \n  x', 'api_key=>"sk-x"'];
for (const c of cases) {
  const s1 = sanitizeCredentialText(c, { includeEnvironmentCredentials: false });
  const s2 = sanitizeCredentialText(s1, { includeEnvironmentCredentials: false });
  console.log(s1 === s2 ? 'idempotent    ' : 'NON-IDEMPOTENT', JSON.stringify(c), '->', JSON.stringify(s1));
}
let files = 0,
  bad = 0;
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== '.git') walk(p);
    } else if (/\.(m?js|ts|json|md)$/.test(e.name) && fs.statSync(p).size < 1e6) {
      files++;
      const t = fs.readFileSync(p, 'utf8');
      const s1 = sanitizeCredentialText(t);
      if (sanitizeCredentialText(s1) !== s1) {
        bad++;
        console.log('still bad', p);
      }
    }
  }
};
for (const r of process.argv.slice(2)) walk(r);
console.log(`corpus files=${files} non-idempotent=${bad}`);
