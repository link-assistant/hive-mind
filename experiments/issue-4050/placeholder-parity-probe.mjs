#!/usr/bin/env node
// Issue #4050 / upstream #177: compare the library's verdict on a value that is
// NOT followed by a backtick with the adapter's verdict on the same value inside a
// code span. The exemption must never keep something the library itself masks.
import { createRequire } from 'node:module';
import { sanitizeWithPolicy } from '../../src/sensitive-data-sanitizer.lib.mjs';
const { createSyncSanitizer } = createRequire(import.meta.url)('@link-foundation/sensitive-data-sanitizer/credentials');
const library = createSyncSanitizer({ credentialsOnly: true });
const values = ['<value>', '<token>', '<your token>', '<s3cr3tAbc123XYZqwe789>', '<Zx81kQ02mPa9LwT7>', '<a_b>', '$TOKEN', '${TOKEN}', '$x9Kq2LmZ8pW1', '<' + 'k'.repeat(40) + '>'];
for (const value of values) {
  const plain = `Authorization: token ${value}`;
  const span = `\`Authorization: token ${value}\``;
  const libraryKeeps = library.sanitize(plain).text === plain;
  const adapterKeeps = sanitizeWithPolicy(span) === span;
  const flag = adapterKeeps && !libraryKeeps ? 'BROADER' : 'ok';
  console.log(`${flag.padEnd(7)} library(plain)=${libraryKeeps ? 'kept' : 'masked'} adapter(span)=${adapterKeeps ? 'kept' : 'masked'} ${value}`);
}
