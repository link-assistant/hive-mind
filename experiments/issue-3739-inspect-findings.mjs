// Prints the raw library findings and the Hive policy findings for each argv
// input (value-bearing: for local debugging with synthetic data only).
import { loadSensitiveDataSanitizer, findCredentialFindings, sanitizeWithPolicy } from '../src/sensitive-data-sanitizer.lib.mjs';
const lib = loadSensitiveDataSanitizer();
const inputs = process.argv.slice(2).map(a => a.replace(/\\n/g, '\n'));
for (const text of inputs) {
  const det = lib.createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true });
  console.log('INPUT', JSON.stringify(text));
  for (const f of det.inspect(text).findings ?? det.inspect(text)) console.log('  lib', f.rule, f.type, JSON.stringify(text.slice(f.start, f.end)));
  for (const f of findCredentialFindings(text)) console.log('  hive', f.rule, f.type, JSON.stringify(text.slice(f.start, f.end)));
  console.log('  out', JSON.stringify(sanitizeWithPolicy(text)));
}
