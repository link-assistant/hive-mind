// Issue #4055: which code-span Authorization placeholders does sensitive-data-sanitizer
// 0.22.4 keep on its own (upstream #177 fixed, #181 open)? No `exempt` hook here.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const library = require('@link-foundation/sensitive-data-sanitizer/credentials');
const { version } = JSON.parse(readFileSync(new URL('../../node_modules/@link-foundation/sensitive-data-sanitizer/package.json', import.meta.url), 'utf8'));
const sanitizer = library.createSyncSanitizer({ credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } });
// Built at runtime so secret scanners do not flag a synthetic token in the source or output.
const FAKE_TOKEN = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
console.log('version', version);
for (const input of ['`Authorization: token <TOKEN>`', '`Authorization: Bearer $GITHUB_TOKEN`', '`Authorization: Bearer ${TOKEN}`', 'the `Authorization:` header', '``Authorization: token <TOKEN>` ``', `\`Authorization: token ${FAKE_TOKEN}\``]) {
  const output = sanitizer.sanitize(input).text;
  console.log(output === input ? 'kept   ' : 'changed', JSON.stringify(input.replace(FAKE_TOKEN, '<synthetic ghp_ token>')), output === input ? '' : `-> ${JSON.stringify(output)}`);
}
