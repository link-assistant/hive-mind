// Upstream perf probe (link-foundation/sensitive-data-sanitizer): a credential
// keyword followed by one long value makes the gitleaks keyword rules scan the
// whole value (the view is extended "to its real terminator"); on re2-wasm that
// costs roughly 12 µs per character, ~70x plain text. Synthetic data only.
// Usage: node --max-old-space-size=1024 experiments/issue-3739/long-credential-value-perf.mjs [KiB...]
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer/credentials';

const sanitizer = createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true });
const sizes = (process.argv.length > 2 ? process.argv.slice(2) : ['64', '256', '1024']).map(Number);
for (const kib of sizes) {
  const value = 'A'.repeat(kib * 1024);
  for (const [label, text] of [
    ['plain', `${value}\n`],
    ['password=', `password=${value}\n`],
    ['Authorization: Bearer ', `Authorization: Bearer ${value}\n`],
  ]) {
    const started = performance.now();
    let outcome;
    try {
      outcome = { redactions: [].concat(sanitizer.sanitize(text).redactions).length };
    } catch (error) {
      outcome = { error: error.code || error.name };
    }
    const ms = Math.round(performance.now() - started);
    console.log(JSON.stringify({ kib, label, ms, usPerChar: +((ms * 1000) / text.length).toFixed(2), ...outcome }));
  }
}
