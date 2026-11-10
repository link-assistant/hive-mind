// Measure import time and sync throughput of the library vs the Hive Mind core.
const t0 = performance.now();
const lib = await import('@link-foundation/sensitive-data-sanitizer');
const t1 = performance.now();
console.log('import ms', (t1 - t0).toFixed(0));
const s = lib.createSyncSanitizer({ credentialsOnly: true, transformation: { mode: 'hive-mask' } });
const t2 = performance.now();
console.log('create ms', (t2 - t1).toFixed(0));
const { sanitizeCredentialText } = await import('../src/credential-sanitization-core.lib.mjs');
const line = '[2026-10-23T11:39:55.123Z] [INFO] {"type":"assistant","message":{"content":[{"type":"text","text":"Running gh pr view 3741 --repo link-assistant/hive-mind and git log --oneline -5; user konard@example.com id 1431904"}]}}\n';
for (const size of [10_000, 100_000, 1_000_000]) {
  const text = line.repeat(Math.ceil(size / line.length)).slice(0, size);
  let a = performance.now(); s.sanitize(text); let b = performance.now();
  let c = performance.now(); sanitizeCredentialText(text); let d = performance.now();
  console.log(size, 'library ms', (b - a).toFixed(0), 'core ms', (d - c).toFixed(0));
}
const t = performance.now(); s.sanitize('short line with nothing'); console.log('small call ms', (performance.now() - t).toFixed(2));
