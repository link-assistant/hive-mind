#!/usr/bin/env node
/**
 * Issue #2156 — does Secretlint's recommended preset see an *encoded* token?
 *
 * The incident payload was not a bare `gho_…` string: GHCR's token endpoint
 * echoed the supplied PAT back base64-encoded inside a JSON body, which then
 * landed in an agent tool result with every quote backslash-escaped. This probe
 * runs the same preset we ship against four spellings of one synthetic token so
 * we can state, with evidence, which of them the external layer catches.
 *
 * SYNTHETIC TOKEN ONLY. The real leaked value is never written to this repo.
 */
import { detectSecretsWithSecretlint } from '../src/token-sanitization.lib.mjs';

const SYNTHETIC = `gho_${'A'.repeat(12)}SyntheticNotReal${'9'.repeat(8)}`;
const encoded = Buffer.from(SYNTHETIC).toString('base64');
const wrapped = encoded.replace(/(.{20})/g, '$1\n');

const cases = [
  { name: 'plain', text: `token: ${SYNTHETIC}` },
  { name: 'base64 of the token', text: `{"token":"${encoded}"}` },
  { name: 'base64 inside escaped JSON', text: `{"content":"token len ${SYNTHETIC.length}\\n{\\"token\\":\\"${encoded}\\"}\\n"}` },
  { name: 'base64 wrapped at 20 columns', text: `body=\n${wrapped}` },
];

for (const testCase of cases) {
  const findings = await detectSecretsWithSecretlint(testCase.text);
  const rules = [...new Set(findings.map(finding => finding.ruleId))].join(', ') || '—';
  console.log(`${testCase.name.padEnd(30)} findings=${String(findings.length).padStart(2)}  rules=${rules}`);
}
