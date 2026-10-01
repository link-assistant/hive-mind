// Run each synthetic-log part (raw and Codex-JSON-wrapped) through
// sanitizeForPublication with a residual scanner that reports WHICH check fired.
import fs from 'node:fs';
import tsl from '../src/token-sanitization.lib.mjs';
import { findCredentialResiduals, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';

const { sanitizeForPublication, detectSecretsWithSecretlint, containsKnownToken } = tsl;
const parts = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/issue-2397/parts.json', 'utf8'));
const mode = process.argv[3] || 'both';
const hits = [];
const residualScanner = label => async value => {
  const core = findCredentialResiduals(value);
  const sl = await detectSecretsWithSecretlint(value, { required: true });
  const kt = await containsKnownToken(value);
  if (core.length || sl.length || kt.length) {
    const info = { label, core: core.length, secretlint: sl.map(s => s.ruleId), known: kt.map(k => k.name) };
    if (core.length) {
      // locate first differing line between value and its re-sanitized form
      const again = sanitizeCredentialText(value).split('\n');
      const lines = value.split('\n');
      const idx = lines.findIndex((l, i) => l !== again[i]);
      info.coreLineBefore = lines[idx]?.slice(0, 400);
      info.coreLineAfter = again[idx]?.slice(0, 400);
    }
    if (sl.length) info.secretlintSnippets = sl.map(s => value.slice(Math.max(0, s.start - 40), s.end + 20).slice(0, 300));
    hits.push(info);
  }
  return [...core, ...sl, ...kt];
};
for (const p of parts) {
  const variants = [];
  if (mode !== 'json') variants.push(['raw', p.text]);
  if (mode !== 'raw') variants.push(['json', JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: p.text } })]);
  for (const [kind, text] of variants) {
    try {
      await sanitizeForPublication(text, { residualScanner: residualScanner(`${kind}:${p.name}`) });
    } catch (e) {
      let c = e,
        chain = [];
      while (c) {
        chain.push(`${c.name}: ${c.message}`);
        c = c.cause;
      }
      console.log('THROW', kind, p.name, chain.join(' <- '));
    }
  }
}
console.log(JSON.stringify(hits, null, 2));
console.log('total hits', hits.length);
process.exit(0);
