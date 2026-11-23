// Probe: does @link-foundation/sensitive-data-sanitizer (installed version) still
// throw ERR_SANITIZATION on a ~4 MiB letter run in two-byte text (upstream #172)?
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lib = require('@link-foundation/sensitive-data-sanitizer/credentials');
const { version } = JSON.parse(fs.readFileSync(new URL('../../node_modules/@link-foundation/sensitive-data-sanitizer/package.json', import.meta.url)));
const MiB = 1024 * 1024;
const s = lib.createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } });
const run = 'A'.repeat(4 * MiB);
const cases = {
  plainRunWithEmoji: `${run}\n🔐 token refreshed\n`,
  bearerIntoRun: `🔐 Authorization: Bearer ${run}\n`,
  runThenPassword: `${run}\n🔐 token refreshed\npassword=xx-private-value-0123456789\n`,
};
console.log('version', version);
for (const [name, text] of Object.entries(cases)) {
  const started = Date.now();
  try {
    const r = s.sanitize(text);
    console.log(name, 'ok', 'redactions=', r.redactions, 'runKept=', r.text.includes(run), 'secretGone=', !r.text.includes('xx-private-value-0123456789'), `${Date.now() - started}ms`);
  } catch (e) {
    console.log(name, 'THROWS', e.code, `${Date.now() - started}ms`);
  }
}
