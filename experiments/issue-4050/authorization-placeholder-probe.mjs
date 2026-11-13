#!/usr/bin/env node
// Issue #4050: @link-foundation/sensitive-data-sanitizer's `authorization` rule
// masks a documentation placeholder when a closing quote/backtick follows it.
// Prints each sample with the library's credentials-only output ("library") and
// with hive-mind's adapter, which carries the #177 exemption ("adapter").
import { createRequire } from 'node:module';
import { sanitizeWithPolicy } from '../../src/sensitive-data-sanitizer.lib.mjs';
const { createSyncSanitizer, isPlaceholderToken } = createRequire(import.meta.url)('@link-foundation/sensitive-data-sanitizer/credentials');
const sanitizer = createSyncSanitizer({ credentialsOnly: true });
// A synthetic GitHub-shaped token, assembled at runtime and never printed.
const token = ['ghp', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('_');
const samples = ['Authorization: token <value>', '`Authorization: token <value>`', '"Authorization: token <value>"', "'Authorization: Bearer <token>'", '`Authorization: Bearer <token>` header', '`Authorization: Bearer $TOKEN`', '`Authorization: Bearer ${TOKEN}`', `\`Authorization: token ${token}\``];
for (const sample of samples) {
  const shown = value => JSON.stringify(value.replaceAll(token, '<synthetic ghp_ token>'));
  const library = sanitizer.sanitize(sample);
  console.log(`library ${library.redactions ? 'MASKED' : 'kept  '} ${shown(sample)} -> ${shown(library.text)}`);
  const adapter = sanitizeWithPolicy(sample);
  const adapterText = typeof adapter === 'string' ? adapter : adapter.text;
  console.log(`adapter ${adapterText === sample ? 'kept  ' : 'MASKED'} ${shown(sample)} -> ${shown(adapterText)}`);
}
console.log('isPlaceholderToken("<value>") =', isPlaceholderToken?.('<value>'), '; isPlaceholderToken("<value>`") =', isPlaceholderToken?.('<value>`'));
