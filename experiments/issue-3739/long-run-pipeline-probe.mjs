// Every stage of Hive Mind's publication pipeline against long runs of one
// character class (synthetic data only, finite sizes). A RangeError here means
// a regular expression overflowed V8's regexp backtracking stack, and the
// fail-closed boundary then blocks the whole log block.
//
// Usage: node --max-old-space-size=2048 experiments/issue-3739/long-run-pipeline-probe.mjs [MiB] [case-filter]
const MiB = 1024 * 1024;
const size = Number(process.argv[2] || 12) * MiB;
const only = process.argv[3] || '';
const SECRET = 'xx-private-value-0123456789';
const fill = (unit, bytes = size) => unit.repeat(Math.ceil(bytes / unit.length));
const tail = `\n🔐 token refreshed\npassword=${SECRET}\n`;
const cases = {
  'letters-A': fill('A'),
  'letters-Ab': fill('Ab'),
  'hex-ab12': fill('ab12'),
  digits: fill('7'),
  'base64-with-plus': fill('Ab+/'),
  'json-image-line': `{"type":"image","data":"${fill('Ab')}"}`,
  'own-line-base64': `x\n${fill('Ab')}\n`,
  'percent-then-letters': `%41${fill('a')}`,
  'percent-escapes': fill('%41'),
  escapes: fill('\\x41'),
  entities: fill('&#65;'),
  spaces: `a${fill(' ')}b`,
  equals: fill('='),
  dashes: fill('-'),
  underscores: fill('_'),
  dots: fill('.'),
  'cyrillic-letters': fill('Ж', size / 2),
};
const core = await import('../../src/credential-sanitization-core.lib.mjs');
const encoded = await import('../../src/encoded-credential-detection.lib.mjs');
const stream = await import('../../src/log-sanitize-stream.lib.mjs');
const tokens = await import('../../src/token-sanitization.lib.mjs');
const stages = {
  sanitizeCredentialText: text => core.sanitizeCredentialText(text),
  findCredentialResiduals: text => core.findCredentialResiduals(text),
  findDecodableRuns: text => encoded.findDecodableRuns(text),
  findWrappedBase64Runs: text => encoded.findWrappedBase64Runs(text),
  computeReleaseBoundary: text => stream.computeReleaseBoundary(text),
  secretlint: text => tokens.detectSecretsWithSecretlint(text, { required: true }),
  containsKnownToken: text => tokens.containsKnownToken(text, [{ name: 'probe', value: SECRET }]),
  sanitizeForPublication: async text => {
    const out = await tokens.sanitizeForPublication(text);
    if (out.includes(SECRET)) throw new Error('secret survived');
    return out;
  },
};
for (const [name, body] of Object.entries(cases)) {
  if (only && !name.includes(only)) continue;
  const text = body + tail;
  for (const [stage, run] of Object.entries(stages)) {
    const started = Date.now();
    try {
      await run(text);
      console.log(JSON.stringify({ case: name, stage, ok: true, elapsedMs: Date.now() - started }));
    } catch (error) {
      const at = String(error?.cause?.stack || error?.stack || '')
        .split('\n')
        .find(line => line.includes('/src/'));
      console.log(JSON.stringify({ case: name, stage, ok: false, error: `${error?.code || error?.name}: ${String(error?.message).slice(0, 80)}`, at: at?.trim(), elapsedMs: Date.now() - started }));
    }
  }
}
