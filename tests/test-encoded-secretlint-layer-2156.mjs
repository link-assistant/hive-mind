#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2156 — the external rule set must see *decoded* payloads.
 *
 * The issue asks for redundancy between detection methods so that "if one
 * method (our handwritten or external library) will not catch the token, other
 * method - will catch". Aimed naively, that request buys nothing: a pattern
 * scanner matches the bytes it is handed, so a *second* scanner reading the
 * same surface text is blind to an encoded credential in exactly the same way
 * the first one is. `experiments/issue-2156-secretlint-encoded-probe.mjs`
 * demonstrates this — Secretlint's recommended preset flags a bare `gho_…` and
 * reports zero findings for the three encoded spellings that actually leaked.
 *
 * The redundancy that does pay off is running *both* detectors over decoded
 * payloads. These tests pin both directions of that independence:
 *
 *   * a format the maintained core knows, encoded, stays masked (the incident
 *     shape), and
 *   * a format only Secretlint knows, encoded, is masked too — which the core
 *     alone cannot do, and which no amount of surface-level scanning would.
 *
 * Every credential here is synthetic. The value from the incident is
 * deliberately absent: committing it — revoked or not — would re-trigger secret
 * scanning against this repository.
 */

import assert from 'node:assert/strict';

import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { sanitizeOutput } from '../src/token-sanitization.lib.mjs';

// Reading the machine's real tokens is neither needed nor wanted here; these
// cases are about pattern layers, not about the known-token list.
const sanitize = text => sanitizeOutput(text, { skipActiveTokensOutputSanitization: true });

const SYNTHETIC_GHO = `gho_${'A'.repeat(12)}SyntheticNotReal${'9'.repeat(8)}`;

// `shpat_` is the load-bearing choice: Secretlint's shopify rule matches it and
// the maintained core has no rule for it. If the core ever grows one this
// assertion turns into a tautology, so it is checked rather than assumed.
const SYNTHETIC_SHOPIFY = `shpat_synthetic${'0'.repeat(23)}`;

const base64 = value => Buffer.from(value).toString('base64');

{
  // The incident shape, end to end. GHCR's token endpoint echoes the PAT it was
  // given back inside a JSON body, base64-encoded; that body reached the log as
  // an escaped JSON string inside an agent tool result.
  const encoded = base64(SYNTHETIC_GHO);
  const record = `[INFO] "content": "token len ${SYNTHETIC_GHO.length}\\n{\\"token\\":\\"${encoded}\\"}\\n"`;

  const sanitized = await sanitize(record);
  assert.ok(!sanitized.includes(SYNTHETIC_GHO), 'the plain token must not survive');
  assert.ok(!sanitized.includes(encoded), 'the base64 copy of the token must not survive either');

  // The debug contract survives encoding. Which layer gets there first is not
  // fixed — here the escaped-JSON assignment rule masks the run in place before
  // anything decodes it — so what is pinned is the guarantee both layers owe:
  // the record keeps its structure and shows the credential's ends.
  assert.match(sanitized, /\\"token\\":\\"Z2h…[^"\\]*\\"/, `the record must keep its shape around a masked run: ${sanitized}`);
  assert.ok(sanitized.startsWith(`[INFO] "content": "token len ${SYNTHETIC_GHO.length}`), 'surrounding log content must be untouched');
}

{
  // Independence, the direction only the external layer can serve.
  //
  // The payload deliberately carries no `token=`-style assignment around the
  // credential. With one, the core's structured-assignment rule would mask it
  // on the strength of the *key* alone and the test would pass without
  // Secretlint contributing anything — which is how a first draft of this test
  // fooled itself. Both preconditions are asserted rather than assumed, so a
  // future core rule for this format demotes the case to a duplicate instead
  // of letting it pass for the wrong reason.
  const payload = `rotating shop credential ${SYNTHETIC_SHOPIFY} for storefront sync`;
  const encoded = base64(payload);
  assert.equal(sanitizeCredentialText(payload), payload, 'precondition: the maintained core has no rule for this credential');
  assert.equal(sanitizeCredentialText(`resp=${encoded}`), `resp=${encoded}`, 'precondition: the core misses it encoded too, so only the external layer can catch it');

  const sanitized = await sanitize(`resp=${encoded}`);
  assert.ok(!sanitized.includes(encoded), 'an encoded credential only Secretlint knows must still be masked');

  const decoded = Buffer.from(sanitized.replace('resp=', ''), 'base64').toString('utf8');
  assert.ok(!decoded.includes(SYNTHETIC_SHOPIFY), `the decoded payload must not carry the credential, got ${decoded}`);
  assert.equal(decoded, `rotating shop credential shp…000 for storefront sync`, 'surrounding text must survive re-encoding intact');
}

{
  // Line-wrapped base64 is the same credential with newlines in it — the shape
  // an HTTP body or a PEM block takes in a log.
  const encoded = base64(SYNTHETIC_GHO);
  const sanitized = await sanitize(`body=\n${encoded.replace(/(.{20})/g, '$1\n')}`);
  assert.ok(!sanitized.includes(SYNTHETIC_GHO), 'the plain token must not survive wrapping');
  assert.ok(!sanitized.includes(encoded.slice(0, 24)), 'no alignment-stable fragment of the encoded token may survive');
}

{
  // Innocent encoded content must be left exactly as it was. A layer that
  // rewrites every decodable run destroys log content, and an operator who
  // cannot trust the log will stop reading it.
  const innocent = base64('the quick brown fox jumps over the lazy dog');
  assert.equal(await sanitize(`payload=${innocent}`), `payload=${innocent}`, 'encoded content without credentials must pass through untouched');
}

{
  // Issue #1745's carve-out is a *surface-text* exemption and stops at the
  // decoder. It is expressed as literal spans to leave alone, which an encoded
  // run does not contain; extending it through decoding would mean a caller's
  // exclusion list could open a hole in the one layer this incident proved we
  // need. Over-redacting an encoded blob costs a line of log detail, so the
  // asymmetry is deliberate and pinned here rather than left to be rediscovered.
  const encoded = base64(`{"token":"${SYNTHETIC_SHOPIFY}"}`);
  const withExclusion = await sanitizeOutput(`resp=${encoded}`, {
    skipActiveTokensOutputSanitization: true,
    excludeTokens: [SYNTHETIC_SHOPIFY],
  });
  assert.ok(!withExclusion.includes(encoded), 'an exclusion must not exempt a credential that only appears encoded');

  // The same value spelled plainly is still exempt, which is the behaviour
  // #1745 actually asked for.
  const plain = `see ${SYNTHETIC_SHOPIFY} in the issue body`;
  assert.equal(await sanitizeOutput(plain, { skipActiveTokensOutputSanitization: true, excludeTokens: [SYNTHETIC_SHOPIFY] }), plain, 'excluded tokens must still pass through in plain text');
}

console.log('encoded secretlint layer tests passed (issue #2156)');
