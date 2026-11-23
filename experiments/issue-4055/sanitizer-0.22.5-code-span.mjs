// Issue #4055: does sensitive-data-sanitizer 0.22.5 (upstream #181 fixed) keep every
// code-span Authorization placeholder on its own, so the adapter's `exempt` hook can go?
// No `exempt` hook here. Also checks that the whole CHANGELOG.md is kept unchanged.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const library = require('@link-foundation/sensitive-data-sanitizer/credentials');
const { version } = JSON.parse(readFileSync(new URL('../../node_modules/@link-foundation/sensitive-data-sanitizer/package.json', import.meta.url), 'utf8'));
const sanitizer = library.createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } });
// Built at runtime so secret scanners do not flag a synthetic token in the source or output.
const FAKE_TOKEN = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
console.log('version', version);
const inputs = ['`Authorization: token <TOKEN>`', '`Authorization: Bearer $GITHUB_TOKEN`', '`Authorization: Bearer ${TOKEN}`', 'the `Authorization:` header', '`Authorization:` header named in prose, then `Authorization: token <value>` on the same line', '``Authorization: token <TOKEN>` ``', '``Authorization: token <TOKEN>``', '`Proxy-Authorization: Basic <value>`', `\`Authorization: token ${FAKE_TOKEN}\``, `\`\`Authorization: token ${FAKE_TOKEN}\` \`\``, `\`Authorization: token ${FAKE_TOKEN}<value>\``];
for (const input of inputs) {
  const output = sanitizer.sanitize(input).text;
  const label = s => JSON.stringify(s.replaceAll(FAKE_TOKEN, '<synthetic ghp_ token>'));
  console.log(output === input ? 'kept   ' : 'changed', label(input), output === input ? '' : `-> ${label(output)}`);
}
const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
const result = sanitizer.sanitize(changelog);
console.log('CHANGELOG.md', result.text === changelog ? 'kept unchanged' : `changed (${result.redactions} redactions)`);
