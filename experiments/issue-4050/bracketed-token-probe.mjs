#!/usr/bin/env node
// Issue #4050 / upstream #177: the code-span exemption accepts `<name>` templates.
// A real token wrapped in angle brackets must still be masked by the token rules.
import { sanitizeWithPolicy } from '../../src/sensitive-data-sanitizer.lib.mjs';
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';
const token = ['ghp', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('_');
const lines = [`\`Authorization: token <${token}>\``, `\`Authorization: Bearer <${token}>\` header`];
for (const line of lines) {
  for (const [name, fn] of [
    ['policy', sanitizeWithPolicy],
    ['publication', sanitizeForPublication],
  ]) {
    const out = await fn(line);
    const text = typeof out === 'string' ? out : out.text;
    console.log(`${name.padEnd(11)} ${text.includes(token) ? 'LEAKED' : 'masked'} ${JSON.stringify(text)}`);
  }
}
