#!/usr/bin/env node
/* global console, process */
// Issue #2837: rewrite committed evidence (case-study logs, dev session logs,
// experiment captures) that recorded AI tool account identifiers.
//
//   node experiments/issue-2837/redact-committed-logs.mjs          # dry run
//   node experiments/issue-2837/redact-committed-logs.mjs --write  # rewrite files
//
// 1. Every identity field (`user.email=`, `anthropic-organization-id: …`, …) is
//    redacted with the same core rule the publication sanitizer uses.
// 2. Every value such a field ever held is redacted wherever else it appears in
//    those files (JSON dumps, prose, stack traces), except git author e-mails,
//    which are public commit metadata, and documentation placeholders.
// Values are never printed; the report shows masked previews and counts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { sanitizeAccountIdentityFields } from '../../src/credential-sanitization-core.lib.mjs';
import { collectIdentityValues } from './collect-committed-identities.mjs';

const write = process.argv.includes('--write');
const SCOPE = ['docs/case-studies', 'dev/log', 'experiments', ':!experiments/issue-2837'];
const IDENTITY_FIELD_GREP = 'user\\.(email|account_id)|anthropic-(organization|workspace)-id|chatgpt-account-id|openai-(organization|project)|emailAddress|accountUuid|organizationUuid';
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const listFiles = args => {
  try {
    return git(args).split('\n').filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
};
const isPlaceholder = value => /@(?:example\.(?:com|org)|users\.noreply\.github\.com)$/i.test(value) || /^0a1b2c3d-|^11111111-2222-/.test(value);
const authorEmails = new Set(git(['log', '--format=%ae%n%ce']).split('\n').filter(Boolean));
const mask = value => `${value.slice(0, 3)}…${value.slice(-3)}`;

const fieldFiles = listFiles(['grep', '-lIE', IDENTITY_FIELD_GREP, '--', ...SCOPE]);
const values = new Set();
for (const file of fieldFiles) for (const value of collectIdentityValues(fs.readFileSync(file, 'utf8'))) if (!isPlaceholder(value) && !authorEmails.has(value)) values.add(value);

const valueFiles = values.size ? listFiles(['grep', '-lIF', ...[...values].flatMap(value => ['-e', value]), '--', ...SCOPE]) : [];
const files = [...new Set([...fieldFiles, ...valueFiles])].sort();
const valueHits = new Map([...values].map(value => [value, 0]));
let changed = 0;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  let text = sanitizeAccountIdentityFields(original);
  for (const value of values) {
    if (!text.includes(value)) continue;
    valueHits.set(value, valueHits.get(value) + text.split(value).length - 1);
    text = text.split(value).join('[REDACTED]');
  }
  if (text === original) continue;
  changed++;
  console.log(`${write ? 'rewrote' : 'would rewrite'} ${file}`);
  if (write) fs.writeFileSync(file, text);
}
for (const [value, hits] of valueHits) console.log(`  ${mask(value)}: ${hits} occurrence(s) outside identity fields`);
console.log(`${changed} of ${files.length} file(s) ${write ? 'rewritten' : 'to rewrite'}; ${values.size} distinct identifier(s)`);
