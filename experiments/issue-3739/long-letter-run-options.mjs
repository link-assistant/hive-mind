// Bisect which Hive Mind sanitizer option makes a long letter run fail (#170 follow-up).
// Usage: node --max-old-space-size=1500 experiments/issue-3739/long-letter-run-options.mjs [MiB] [unit]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lib = require('@link-foundation/sensitive-data-sanitizer/credentials');
const mib = Number(process.argv[2] || 4);
const unit = process.argv[3] || 'Ab';
const text = `${unit.repeat((mib * 1024 * 1024) / unit.length)}\npassword=xx-private-value-0123456789\n`;
const base = { credentialsOnly: true };
const variants = {
  base,
  preserveEncoding: { ...base, preserveEncoding: true },
  hiveMask: { ...base, transformation: { mode: 'hive-mask' } },
  privateKeyRedact: { ...base, transformations: { PRIVATE_KEY: { mode: 'redact' } } },
  knownSecrets: { ...base, knownSecrets: ['known-secret-value-0123456789'] },
  hive: { ...base, preserveEncoding: true, transformation: { mode: 'hive-mask' }, transformations: { PRIVATE_KEY: { mode: 'redact' } }, knownSecrets: [], knownOnly: false },
  hiveWithKnown: { ...base, preserveEncoding: true, transformation: { mode: 'hive-mask' }, transformations: { PRIVATE_KEY: { mode: 'redact' } }, knownSecrets: ['known-secret-value-0123456789'] },
};
for (const [name, options] of Object.entries(variants)) {
  if (process.argv[4] && process.argv[4] !== name) continue;
  const started = Date.now();
  try {
    const result = lib.createSyncSanitizer(options).sanitize(text);
    console.log(JSON.stringify({ name, mib, unit, ok: true, redactions: result.redactions, elapsedMs: Date.now() - started }));
  } catch (error) {
    console.log(JSON.stringify({ name, mib, unit, ok: false, code: error.code, cause: error.cause?.name, causeMessage: error.cause?.message?.slice(0, 80), elapsedMs: Date.now() - started }));
  }
}
