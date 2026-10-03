// Minimal reproducers for issue #2397: sanitizeCredentialText is not idempotent
// for `key=>value` / `key => value` with a short (<=12 char) value, so the
// residual scan in sanitizeForPublication fires on already-sanitized output.
import { sanitizeCredentialText, findCredentialResiduals } from '../src/credential-sanitization-core.lib.mjs';
import tsl from '../src/token-sanitization.lib.mjs';
const cases = [
  'secret=>LH5qO6yo',
  'const f = token => !token;',
  'tokens.filter(token => token.trim())',
  "{ 'password' => 'hunter2' }",
  ':token => "abc"',
  'password=hunter2', // control
];
for (const c of cases) {
  const s1 = sanitizeCredentialText(c);
  const s2 = sanitizeCredentialText(s1);
  console.log(JSON.stringify({ input: c, pass1: s1, pass2: s2, residual: findCredentialResiduals(s1).length > 0 }));
}
for (const c of cases) {
  try {
    await tsl.sanitizeForPublication(c);
    console.log('publish OK  ', JSON.stringify(c));
  } catch (e) {
    console.log('publish FAIL', JSON.stringify(c), '->', e.message, '| cause:', e.cause?.message);
  }
}
process.exit(0);
