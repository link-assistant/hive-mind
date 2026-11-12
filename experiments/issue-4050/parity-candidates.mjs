#!/usr/bin/env node
// Issue #4050 / upstream #177: template-shaped values that the library masks even
// when no backtick follows them. The code-span exemption must keep masking these.
import { createRequire } from 'node:module';
const { createSyncSanitizer } = createRequire(import.meta.url)('@link-foundation/sensitive-data-sanitizer/credentials');
const library = createSyncSanitizer({ credentialsOnly: true });
const token = ['ghp', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('_');
const aws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const candidates = ['$' + token, '<' + token + '>', '<sk-live abc>', '$' + aws, '<' + aws + '>', '<' + 'Zx8'.repeat(20) + '>'];
for (const value of candidates) {
  const plain = `Authorization: token ${value}`;
  const kept = library.sanitize(plain).text === plain;
  console.log(`${kept ? 'kept  ' : 'masked'} ${JSON.stringify(value.replace(token, '<synthetic ghp_ token>').replace(aws, '<synthetic AKIA key>'))}`);
}
