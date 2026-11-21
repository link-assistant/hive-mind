// Issue #4055: does sensitive-data-sanitizer 0.22.4 handle the #172 inputs itself?
// The #4049 canaries expected ERR_SANITIZATION from 0.22.3.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../../node_modules/@link-foundation/sensitive-data-sanitizer/package.json', import.meta.url), 'utf8'));
const lib = require('@link-foundation/sensitive-data-sanitizer/credentials');
const MiB = 1024 * 1024;
const s = lib.createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } });
const cases = {
  'canary: 4 MiB run + emoji line': `${'A'.repeat(4 * MiB)}\n🔐 token refreshed\n`,
  'Bearer value that is a 4 MiB run': `🔐 Authorization: Bearer ${'A'.repeat(4 * MiB)}\n`,
};
console.log(`version ${pkg.version}`);
for (const [name, text] of Object.entries(cases)) {
  const t0 = Date.now();
  try {
    const r = s.sanitize(text);
    const tail = r.text.slice(-40).replace(/\n/g, '\\n');
    console.log(`${name}: ok in ${Date.now() - t0} ms, redactions ${r.redactions}, length ${text.length} -> ${r.text.length}, value kept: ${r.text.includes('A'.repeat(1024))}, tail ${JSON.stringify(tail)}`);
  } catch (e) {
    console.log(`${name}: threw ${e.code} in ${Date.now() - t0} ms`);
  }
}
