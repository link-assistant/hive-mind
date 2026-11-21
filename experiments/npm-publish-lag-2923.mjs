#!/usr/bin/env node
// Issue #2923: measure npm's asynchronous publish lag per version.
// SLSA provenance is signed by the CI runner right before `npm publish` uploads;
// the npm publish attestation is signed by the registry when the version is
// actually accepted. The gap is how long `npm view pkg@version` can 404 after
// `npm publish` exits 0.
// Usage: node experiments/npm-publish-lag-2923.mjs [package] [count]
const pkg = process.argv[2] || '@link-assistant/hive-mind';
const count = Number(process.argv[3] || 40);
// The registry wants the scope separator encoded: @scope%2fname.
const encoded = pkg.startsWith('@') ? `@${encodeURIComponent(pkg.slice(1))}` : encodeURIComponent(pkg);
const packument = await (await fetch(`https://registry.npmjs.org/${encoded}`)).json();
const versions = Object.keys(packument.versions).slice(-count);
const rows = [];
for (const v of versions) {
  const res = await fetch(`https://registry.npmjs.org/-/npm/v1/attestations/${encoded}@${v}`);
  if (!res.ok) continue;
  const { attestations = [] } = await res.json();
  const t = {};
  for (const a of attestations) {
    const kind = a.predicateType.includes('slsa') ? 'provenance' : 'publish';
    t[kind] = Number(a.bundle.verificationMaterial.tlogEntries[0].integratedTime) * 1000;
  }
  if (t.provenance && t.publish) {
    rows.push({ v, provenance: new Date(t.provenance).toISOString(), lagSeconds: (t.publish - t.provenance) / 1000 });
  }
}
console.table(rows);
const lags = rows.map(r => r.lagSeconds).sort((a, b) => a - b);
const pct = p => lags[Math.min(lags.length - 1, Math.floor((p / 100) * lags.length))];
console.log(JSON.stringify({ samples: lags.length, min: lags[0], p50: pct(50), p90: pct(90), max: lags.at(-1) }));
