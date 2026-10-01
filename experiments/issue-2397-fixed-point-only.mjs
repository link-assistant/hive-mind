// Issue #2397: shows that the bounded fixed-point loop in sanitizeCredentialText
// alone unblocks the reproducer even with the original `(?:=>|[:=])` separator.
// Run: node experiments/issue-2397-fixed-point-only.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const src = readFileSync(new URL('../src/credential-sanitization-core.lib.mjs', import.meta.url), 'utf8').replace("const ASSIGNMENT_SEPARATOR = '(?:=>|[:=](?!>))';", "const ASSIGNMENT_SEPARATOR = '(?:=>|[:=])';");
const dir = mkdtempSync(join(tmpdir(), 'issue-2397-'));
const file = join(dir, 'core.mjs');
writeFileSync(file, src.replaceAll("from './", `from '${new URL('../src/', import.meta.url).pathname}`));
const { sanitizeCredentialText, findCredentialResiduals } = await import(file);
for (const input of ['const f = token => !token;', 'secret=>LH5qO6yo']) {
  const once = sanitizeCredentialText(input);
  console.log(JSON.stringify({ input, once, residuals: findCredentialResiduals(once) }));
}
