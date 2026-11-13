/**
 * @hive-mind-test-suite default
 * Issue #4050: `tests/issue-3445-release-notes-not-masked.test.mjs` failed on
 * main after the 2.40.1 release commit, because the publication sanitizer turned
 * the release note "… in `Authorization: token <value>` (and any other scheme)"
 * into "… in `Authorization: token [REDACTED] (and any other scheme)".
 *
 * Upstream link-foundation/sensitive-data-sanitizer#177 (0.22.3): an
 * Authorization value does not end at a Markdown backtick, so the value read is
 * "<value>`" and the library's own placeholder exemption misses it.
 * src/sensitive-data-sanitizer.lib.mjs keeps only a complete template followed by
 * the closing backtick of a code span; real and known credentials stay masked.
 *
 * Synthetic data only. Run with:
 *   node --test tests/authorization-code-span-placeholder-4050.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isCodeSpanAuthorizationPlaceholder, sanitizeWithPolicy, UPSTREAM } from '../src/sensitive-data-sanitizer.lib.mjs';
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
];

test('#4050: a placeholder that closes a Markdown code span is not masked', async () => {
  for (const line of KEPT) {
    assert.equal(sanitizeWithPolicy(line), line, line);
    assert.equal(sanitizeCredentialText(line, options), line, line);
    assert.equal(await sanitizeForPublication(line, options), line, line);
  }
});

test('#4050: real credentials in a code span are still masked', async () => {
  for (const line of [`\`Authorization: token ${TOKEN}\``, `\`Authorization: token <${TOKEN}>\``, `\`Authorization: Bearer <value>${TOKEN.slice(4)}\``, `prose \`Authorization: token <value>\` then \`Authorization: token ${TOKEN}\``, `\`Authorization: ${TOKEN}\``, `\`Authorization: token ${TOKEN} \``, `the \`Authorization:\` header, then \`Authorization: token ${TOKEN}\``]) {
    const output = await sanitizeForPublication(line, options);
    assert.ok(!output.includes(TOKEN.slice(4)), output);
  }
});

test('#4050: the exemption needs an opening backtick, a complete template and the header', () => {
  const at = (text, value, rule = 'authorization') => {
    const start = text.lastIndexOf(value);
    return isCodeSpanAuthorizationPlaceholder({ rule, start, end: start + value.length }, text);
  };
  assert.equal(at('`Authorization: token <value>`', '<value>`'), true);
  assert.equal(at('`Authorization: token <value>`', '<value>`', 'context'), true);
  assert.equal(at('`Authorization: token <value>`', '<value>`', 'gitleaks:generic-api-key'), false);
  // No code span opened before the header (an even number of backticks).
  assert.equal(at('Authorization: token <value>`', '<value>`'), false);
  assert.equal(at('`a` Authorization: token <value>`', '<value>`'), false);
  // An empty value: the closing backtick right after the colon (#4057).
  assert.equal(at('the `Authorization:` header', '`'), true);
  assert.equal(at('the `Authorization: Bearer` header', '`'), false, 'the library reads the scheme word as the value');
  assert.equal(at('the Authorization:` header', '`'), false);
  // Not one complete template.
  assert.equal(at('`Authorization: token <a>secret123`', '<a>secret123`'), false);
  assert.equal(at('`Authorization: token $A$B`', '$A$B`'), false);
  // Not after an Authorization header.
  assert.equal(at('`password: <value>`', '<value>`'), false);
  // The code span must open on the same line.
  assert.equal(at('`\nAuthorization: token <value>`', '<value>`'), false);
  // Never broader than the library: a template-shaped value it masks without a
  // backtick (here a synthetic AWS key id) is not exempt inside a code span either.
  const aws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  for (const value of [`$${aws}`, `<${aws}>`]) {
    assert.equal(at(`\`Authorization: token ${value}\``, `${value}\``), false, value);
    assert.ok(!sanitizeWithPolicy(`\`Authorization: token ${value}\``).includes(aws), value);
  }
});

test('#4050: a value declared as a known secret is never exempt', () => {
  const output = sanitizeWithPolicy('`Authorization: Bearer $LEAKED_VALUE`', { knownSecrets: ['$LEAKED_VALUE'] });
  assert.ok(!output.includes('$LEAKED_VALUE'), output);
});

test('#4050: the workaround names the upstream issue it waits for', () => {
  assert.equal(UPSTREAM.authorizationCodeSpanPlaceholder, 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/177');
});
