/**
 * @hive-mind-test-suite default
 * Issue #4050: `tests/issue-3445-release-notes-not-masked.test.mjs` failed on
 * main after the 2.40.1 release commit, because the publication sanitizer turned
 * the release note "… in `Authorization: token <value>` (and any other scheme)"
 * into "… in `Authorization: token [REDACTED] (and any other scheme)".
 *
 * Upstream link-foundation/sensitive-data-sanitizer#177 (0.22.3): an
 * Authorization value did not end at a Markdown backtick, so the value read was
 * "<value>`" and the library's own placeholder exemption missed it. The 2.40.2
 * release note then named the header with no value (`Authorization:` closed at
 * once) ahead of a double-backtick example (#181). Hive Mind kept such
 * placeholders with an `exempt` hook until 0.22.4 fixed #177 and 0.22.5 fixed
 * #181; the hook was then removed (issue #4055), so these checks now guard the
 * library's own behaviour: placeholders are kept, real and known credentials
 * stay masked.
 *
 * Synthetic data only. Run with:
 *   node --test tests/authorization-code-span-placeholder-4050.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeWithPolicy, UPSTREAM } from '../src/sensitive-data-sanitizer.lib.mjs';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

const options = { includeEnvironmentCredentials: false };
const TOKEN = ['ghp', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('_');

const KEPT = [
  // The 2.40.1 CHANGELOG line, shortened.
  '- b83e3e0: Fix the credential sanitizer masking the scheme word instead of the credential in `Authorization: token <value>` (and any other scheme), which published the value',
  '`Authorization: Bearer <token>` header',
  '`Authorization: Bearer $TOKEN`',
  '`Authorization: Bearer ${GITHUB_TOKEN}` and `Proxy-Authorization: Basic <credentials>`',
  'see `curl -H Authorization:<value>`',
  // The 2.40.2 CHANGELOG line (#4057): a header named in prose, closed right
  // after the colon, ahead of a placeholder in a double-backtick code span.
  'masks a placeholder that closes a code span after an `Authorization:` header (for example `` `Authorization: token <value>` `` in the 2.40.1 release notes)',
  'the `Authorization:` header',
  'the `Proxy-Authorization:` and `Authorization:` headers',
  '`Authorization:` and `Proxy-Authorization:` headers',
  'a documentation placeholder that closes a Markdown code span after an `Authorization:` header (for example `` `Authorization: token <value>` `` in the 2.40.1 release notes)',
];

test('#4050: a placeholder that closes a Markdown code span is not masked', async () => {
  for (const line of KEPT) {
    assert.equal(sanitizeWithPolicy(line), line, line);
    assert.equal(sanitizeCredentialText(line, options), line, line);
    assert.equal(await sanitizeForPublication(line, options), line, line);
  }
});

test('#4050: real credentials in a code span are still masked', async () => {
  for (const line of [`\`Authorization:\` header \`Authorization: token ${TOKEN}\``, `\`Authorization: token ${TOKEN}\``, `\`Authorization: token <${TOKEN}>\``, `\`Authorization: Bearer <value>${TOKEN.slice(4)}\``, `prose \`Authorization: token <value>\` then \`Authorization: token ${TOKEN}\``, `\`Authorization: ${TOKEN}\``, `\`Authorization: token ${TOKEN} \``, `the \`Authorization:\` header, then \`Authorization: token ${TOKEN}\``]) {
    const output = await sanitizeForPublication(line, options);
    assert.ok(!output.includes(TOKEN.slice(4)), output);
  }
});

test('#4050: a template-shaped value the library masks on its own stays masked in a code span', () => {
  // A synthetic AWS key id spelled as a template is still a credential.
  const aws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  for (const value of [`$${aws}`, `<${aws}>`]) {
    assert.ok(!sanitizeWithPolicy(`\`Authorization: token ${value}\``).includes(aws), value);
  }
});

test('#4050: a value declared as a known secret is never exempt', () => {
  const output = sanitizeWithPolicy('`Authorization: Bearer $LEAKED_VALUE`', { knownSecrets: ['$LEAKED_VALUE'] });
  assert.ok(!output.includes('$LEAKED_VALUE'), output);
});

test('#4050: no code-span workaround is left once upstream #177 and #181 shipped', () => {
  // #177 shipped in 0.22.4 and #181 in 0.22.5 (issue #4055); a returning entry
  // means a workaround was reintroduced and needs its own upstream link.
  assert.equal(UPSTREAM.authorizationCodeSpanPlaceholder, undefined);
  assert.equal(UPSTREAM.doubleBacktickCodeSpanPlaceholder, undefined);
});
