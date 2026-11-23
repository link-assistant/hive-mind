// Prints the sanitizer findings (rule + matched text) for the 2.40.2 CHANGELOG line
// Usage: node experiments/issue-4048-changelog-sanitize-findings.mjs ["text" ...]
// that the release-notes test (#3445) reports as changed.
import { readFileSync } from 'node:fs';
import { loadSensitiveDataSanitizer } from '../src/sensitive-data-sanitizer.lib.mjs';
const lib = loadSensitiveDataSanitizer();
const samples = process.argv.slice(2);
if (samples.length === 0)
  samples.push(
    readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
      .split('\n')
      .find(l => l.includes('sensitive-data-sanitizer#177'))
  );
for (const text of samples) {
  const findings = [];
  lib.createSyncSanitizer({ credentialsOnly: true, exempt: (f, t) => (findings.push({ rule: f.rule, value: t.slice(f.start, f.end), before: t.slice(Math.max(0, f.start - 30), f.start) }), false) }).sanitize(text);
  console.log(JSON.stringify(text.slice(0, 80)));
  for (const f of findings) console.log('  ', JSON.stringify(f));
}
