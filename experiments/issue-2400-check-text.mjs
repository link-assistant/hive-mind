#!/usr/bin/env node
// Issue #2400: run one text file through the publication sanitizer and print
// which check (if any) blocks it. Run it from the checkout you want to test.
//   node experiments/issue-2400-check-text.mjs <file>
import fs from 'node:fs/promises';
import { findCredentialResiduals } from '../src/credential-sanitization-core.lib.mjs';
import { sanitizeForPublication, detectSecretsWithSecretlint, containsKnownToken, sanitizeOutput } from '../src/token-sanitization.lib.mjs';

const text = await fs.readFile(process.argv[2], 'utf8');
try {
  await sanitizeForPublication(text);
  console.log('PASS: publication allowed');
} catch (error) {
  console.log(`BLOCKED: ${error.message}; cause: ${error.cause?.message}; stage: ${error.stage ?? 'n/a'}; findings: ${JSON.stringify(error.findings ?? null)}`);
  const sanitized = await sanitizeOutput(text);
  const residuals = findCredentialResiduals(sanitized);
  console.log(
    `findCredentialResiduals: ${residuals.length}`,
    residuals.map(r => r.ruleId)
  );
  console.log(`secretlint: ${(await detectSecretsWithSecretlint(sanitized, { required: true })).length}`);
  console.log(`known tokens: ${(await containsKnownToken(sanitized)).length}`);
}
