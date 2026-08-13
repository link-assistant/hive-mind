#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Security regression coverage for issue #2156.
 *
 * A `gho_` GitHub CLI OAuth token reached a public gist through the log-upload
 * path and GitHub's secret scanning revoked it. Two independent defects had to
 * line up for that to happen, and both are covered here:
 *
 *   1. The credential appeared only base64-encoded. GHCR's token endpoint
 *      echoes the PAT supplied via `Authorization: Basic` back inside a JSON
 *      body, base64-encoded. Every sanitizer layer compared bytes literally, so
 *      the encoded copy was invisible to all of them. GitHub's scanner decodes
 *      before matching, so it saw what we did not.
 *
 *   2. The surrounding JSON was backslash-escaped. Agent tool results embed
 *      stdout as a JSON *string*, so the bytes on disk read `{\"token\":\"…\"}`.
 *      The structured-assignment rules only accepted bare quotes, which means
 *      the generic `token` / `password` / `api_key` rules silently did nothing
 *      for the single most common shape in our own logs.
 *
 * Every credential in this file is synthetic. The value from the incident is
 * deliberately absent: committing it — revoked or not — would re-trigger secret
 * scanning against this repository.
 */

import assert from 'node:assert/strict';

import { createCredentialStreamSanitizer, sanitizeCredentialText, findCredentialResiduals, maskToken } from '../src/credential-sanitization-core.lib.mjs';
import { base64AlignmentFragments, encodedRepresentations, findEncodedKnownTokenRuns, printableRatio, sanitizeEncodedCredentials } from '../src/encoded-credential-detection.lib.mjs';
import { containsKnownToken, sanitizeCommentBody, sanitizeForPublication, sanitizeOutput } from '../src/token-sanitization.lib.mjs';

// A 40-character `gho_` token, matching the real format without being one.
const SYNTHETIC_GHO = `gho_${'S'}YNTHETIC${'0'.repeat(4)}NotARealToken${'1'.repeat(10)}`;
assert.equal(SYNTHETIC_GHO.length, 40, 'fixture must match the real gho_ token length');

const KNOWN_TOKENS = [{ source: 'gh-command', name: 'github', value: SYNTHETIC_GHO }];

const assertAbsent = (output, needles, message) => {
  for (const needle of needles) {
    assert.ok(!output.includes(needle), `${message}: ${needle.slice(0, 6)}… survived`);
  }
};

// ---------------------------------------------------------------------------
// Root cause 2 — backslash-escaped JSON assignments
// ---------------------------------------------------------------------------

{
  const secret = 'SYNTHETIC_ESCAPED_JSON_VALUE_9999';

  // The plain shape always worked.
  assert.ok(!sanitizeCredentialText(`{"token":"${secret}"}`).includes(secret), 'bare-quoted JSON assignment must be masked');

  // The escaped shape is what our logs actually contain, and is what leaked.
  const escaped = `{\\"token\\":\\"${secret}\\"}`;
  const sanitizedEscaped = sanitizeCredentialText(escaped);
  assert.ok(!sanitizedEscaped.includes(secret), 'backslash-escaped JSON assignment must be masked');
  assert.ok(sanitizedEscaped.includes(maskToken(secret)), 'escaped assignment must keep the first/last characters for debugging');
  assert.ok(sanitizedEscaped.startsWith('{\\"token\\":\\"') && sanitizedEscaped.endsWith('\\"}'), 'escaping and structure must survive masking');

  // Double escaping (a tool result nested inside another tool result).
  const doubleEscaped = `{\\\\"password\\\\":\\\\"${secret}\\\\"}`;
  assert.ok(!sanitizeCredentialText(doubleEscaped).includes(secret), 'double-escaped assignment must be masked');

  // Issue #2119 carve-out must still hold: token *counters* are not credentials.
  for (const counter of ['{\\"tokens\\": 1234}', '{\\"input_tokens\\": 55}', '{"tokens": {']) {
    assert.equal(sanitizeCredentialText(counter), counter, `token counter must not be masked: ${counter}`);
  }

  // Semver ranges under a key containing "secret" are not credentials either.
  // `SENSITIVE_KEY` matches any key *containing* `secret`, which made the
  // escape-aware rules start rewriting package.json dependency pins.
  for (const dependency of ['"@secretlint/secretlint-rule-preset-recommend": "^13.0.2"', '\\"secretlint\\": \\"^13.0.2\\"', '"secretlint": ">=4.0.0 <5.0.0"', '"secret-version": "~1.2.3-beta.1"']) {
    assert.equal(sanitizeCredentialText(dependency), dependency, `dependency version must not be masked: ${dependency}`);
  }
}

// ---------------------------------------------------------------------------
// Root cause 1 — credentials present only in an encoded form
// ---------------------------------------------------------------------------

{
  // The exact shape of the leak: a GHCR token-exchange body, base64-encoded,
  // embedded in an escaped-JSON agent tool result.
  const body = JSON.stringify({ token: SYNTHETIC_GHO });
  const encodedBody = Buffer.from(body).toString('base64');
  const toolResult = `{"type":"tool_result","content":"token len 40\\n{\\"token\\":\\"${encodedBody}\\"}\\n"}`;

  assert.ok(toolResult.includes(encodedBody), 'fixture must contain the encoded credential');
  assertAbsent(sanitizeCredentialText(toolResult), [encodedBody, SYNTHETIC_GHO], 'sync core must mask the encoded credential');
  assertAbsent(await sanitizeOutput(toolResult), [encodedBody, SYNTHETIC_GHO], 'sanitizeOutput must mask the encoded credential');
  assertAbsent(await sanitizeCommentBody(toolResult, { knownTokens: KNOWN_TOKENS }), [encodedBody, SYNTHETIC_GHO], 'sanitizeCommentBody must mask the encoded credential');
  assertAbsent(await sanitizeForPublication(toolResult), [encodedBody, SYNTHETIC_GHO], 'publication boundary must mask the encoded credential');
}

{
  // A credential encoded inside a larger payload: the other fields must
  // survive, the credential must not, and the result must still decode.
  const payload = JSON.stringify({ user: 'octocat', expires_in: 300, access_token: SYNTHETIC_GHO, scope: 'repo' });
  const encoded = Buffer.from(payload).toString('base64');
  const sanitized = sanitizeCredentialText(`Response body (base64): ${encoded} -- end`);

  assertAbsent(sanitized, [encoded, SYNTHETIC_GHO], 'embedded encoded credential must be masked');
  const rebuilt = sanitized.match(/\(base64\): ([A-Za-z0-9+/=]+)/);
  assert.ok(rebuilt, 'the run must be rebuilt in place rather than dropped');
  const decoded = Buffer.from(rebuilt[1], 'base64').toString('utf8');
  assert.ok(decoded.includes('octocat') && decoded.includes('"scope":"repo"'), 'non-secret payload fields must survive re-encoding');
  assert.ok(decoded.includes(maskToken(SYNTHETIC_GHO)), 'the masked credential must keep its first/last characters inside the payload');
  assert.ok(!decoded.includes(SYNTHETIC_GHO), 'the decoded payload must not carry the credential');
}

{
  // Every encoding the detector claims to cover, plus nesting.
  const payload = JSON.stringify({ access_token: SYNTHETIC_GHO });
  const cases = [
    ['base64', Buffer.from(payload).toString('base64')],
    ['base64url', Buffer.from(payload).toString('base64url')],
    ['hex', Buffer.from(payload).toString('hex')],
    ['hex-upper', Buffer.from(payload).toString('hex').toUpperCase()],
    ['percent', encodeURIComponent(payload)],
    ['base64-of-base64', Buffer.from(Buffer.from(payload).toString('base64')).toString('base64')],
  ];
  for (const [name, encoded] of cases) {
    const sanitized = sanitizeCredentialText(`payload=${encoded}`);
    assertAbsent(sanitized, [encoded, SYNTHETIC_GHO], `${name} credential must be masked`);
    assert.deepEqual(findCredentialResiduals(sanitized), [], `${name} must leave no residual`);
  }
}

{
  // Residual detection: an encoded credential must block publication rather
  // than be published. Fail-closed is the whole point of the boundary.
  const encoded = Buffer.from(JSON.stringify({ access_token: SYNTHETIC_GHO })).toString('base64');
  assert.notDeepEqual(findCredentialResiduals(`blob ${encoded}`), [], 'encoded credential must register as a residual');

  await assert.rejects(
    () => sanitizeForPublication(`blob ${encoded}`, { scanner: async value => value }),
    error => error.code === 'ERR_CREDENTIAL_SANITIZATION',
    'a scanner that fails to mask an encoded credential must block publication'
  );
}

// ---------------------------------------------------------------------------
// Known-local tokens in encoded form
// ---------------------------------------------------------------------------

{
  // Alignment-stable fragments: a base64 payload containing the token must
  // match at whichever of the three byte offsets it happens to land on.
  const fragments = base64AlignmentFragments(SYNTHETIC_GHO);
  assert.ok(fragments.length > 0, 'alignment fragments must be produced');
  for (let offset = 0; offset < 6; offset++) {
    const blob = Buffer.from(`${'x'.repeat(offset)}${SYNTHETIC_GHO}${'y'.repeat(7)}`).toString('base64');
    assert.ok(
      fragments.some(fragment => blob.includes(fragment)),
      `no alignment fragment matched a payload at byte offset ${offset}`
    );
    const hits = findEncodedKnownTokenRuns(`prefix ${blob} suffix`, [SYNTHETIC_GHO]);
    assert.ok(hits.length > 0, `known-token scan missed the encoded token at byte offset ${offset}`);
  }

  // The encodings we advertise are all reachable from a raw value. A token
  // made only of unreserved characters has no distinct percent form and its
  // base64 needs no URL-safe substitution, so those two are exercised with a
  // value that actually differs under them.
  const alwaysPresent = new Set(encodedRepresentations(SYNTHETIC_GHO).map(entry => entry.encoding));
  for (const encoding of ['base64', 'hex', 'hex-upper', 'unicode-escape', 'hex-escape', 'html-entity']) {
    assert.ok(alwaysPresent.has(encoding), `encodedRepresentations must cover ${encoding}`);
  }
  const punctuated = new Set(encodedRepresentations('sk-ant+api03/SYNTHETIC/not+real/value=').map(entry => entry.encoding));
  for (const encoding of ['percent', 'percent-full']) {
    assert.ok(punctuated.has(encoding), `encodedRepresentations must cover ${encoding}`);
  }

  // URL-safe base64 differs from the standard alphabet only where a fragment
  // happens to contain `+` or `/`, so assert the behaviour rather than the
  // representation list: a base64url payload must still be matched.
  const urlSafeBlob = Buffer.from(`prefix-${SYNTHETIC_GHO}-suffix`).toString('base64url');
  assert.ok(findEncodedKnownTokenRuns(`blob=${urlSafeBlob}`, [SYNTHETIC_GHO]).length > 0, 'base64url payloads must be matched');

  // A representation that degenerates to the plaintext adds nothing — the
  // verbatim layer already covers it — and would double-report every hit.
  for (const { needle } of encodedRepresentations(SYNTHETIC_GHO)) {
    assert.notEqual(needle, SYNTHETIC_GHO, 'plaintext must not be offered as an encoded representation');
  }

  // Short values are never treated as credentials — that way lies masking
  // every three-letter word in the log.
  assert.deepEqual(findEncodedKnownTokenRuns(Buffer.from('abc').toString('base64'), ['abc']), [], 'short values must be ignored');
}

{
  // `containsKnownToken` decides whether the bridge fires a leak warning and
  // whether the publication boundary blocks. It must see encoded copies too.
  const raw = `body ${Buffer.from(SYNTHETIC_GHO).toString('base64')} end`;

  const plaintextHits = await containsKnownToken(`bare ${SYNTHETIC_GHO}`, KNOWN_TOKENS);
  assert.equal(plaintextHits.length, 1);
  assert.equal(plaintextHits[0].encoding, 'plaintext');
  assert.equal(plaintextHits[0].source, 'gh-command', 'hit must identify the source without echoing the value');

  const encodedHits = await containsKnownToken(raw, KNOWN_TOKENS);
  assert.equal(encodedHits.length, 1, 'encoded known token must be reported');
  assert.equal(encodedHits[0].encoding, 'base64');

  // A hit must never carry the credential itself.
  assert.ok(!JSON.stringify(encodedHits).includes(SYNTHETIC_GHO.slice(4)), 'hit reports must not echo the token');

  assert.deepEqual(await containsKnownToken(await sanitizeCommentBody(raw, { knownTokens: KNOWN_TOKENS }), KNOWN_TOKENS), [], 'sanitized output must report no known-token hits');
  assert.deepEqual(await containsKnownToken('nothing to see here', KNOWN_TOKENS), [], 'clean text must report no hits');
}

// ---------------------------------------------------------------------------
// Guards against over-masking
// ---------------------------------------------------------------------------

{
  // The encoded layer inherits the plaintext rules, so anything the plaintext
  // sanitizer leaves alone must survive encoding too. Long base64-looking runs
  // are everywhere in a log — commit ranges, cache keys, data URIs, IDs.
  const benign = ['sha256:9f2ac1e5d3b8471bc0a6e5f4d2c1b0a99887766554433221100ffeeddccbbaa99', `data:image/png;base64,${Buffer.from('PNG\r\n\n binary-ish payload that is not a credential').toString('base64')}`, Buffer.from('the quick brown fox jumps over the lazy dog, repeatedly').toString('base64'), 'GET /repos/link-assistant/hive-mind/actions/runs?per_page=100&page=2', 'abcdefabcdefabcdefabcdefabcdefabcdefabcd', '/home/runner/work/hive-mind/hive-mind/node_modules/.cache/some-long-directory-name'];
  for (const text of benign) {
    assert.equal(sanitizeCredentialText(text), text, `benign content must not be rewritten: ${text.slice(0, 40)}…`);
  }

  // Binary blobs decode to noise; text-oriented rules over noise invent
  // credentials that are not there, so the printable-ratio gate rejects them.
  const binary = Buffer.from(Array.from({ length: 256 }, (_value, index) => index)).toString('base64');
  assert.ok(printableRatio(Buffer.from(binary, 'base64').toString('utf8')) < 0.9, 'binary payloads must fail the printable gate');
  assert.equal(sanitizeCredentialText(`blob ${binary}`), `blob ${binary}`, 'binary blobs must be left alone');
}

{
  // Idempotence: sanitizing already-sanitized output must be a no-op.
  // Without it every re-publication would nest masks until the text is
  // unreadable, and the residual scanner would never converge.
  const encoded = Buffer.from(JSON.stringify({ token: SYNTHETIC_GHO, note: 'keep me' })).toString('base64');
  const source = `{\\"token\\":\\"${SYNTHETIC_GHO}\\"} and blob=${encoded}`;
  const once = sanitizeCredentialText(source);
  assert.equal(sanitizeCredentialText(once), once, 'sanitization must be idempotent');
  assert.deepEqual(findCredentialResiduals(once), [], 'no residual may remain after one pass');
}

{
  // Recursion safety. Scanning a decoded payload rescans it for further
  // encoded runs; a shared `/g` regular expression carries mutable `lastIndex`,
  // and a nested scan used to rewind the enclosing one into an endless loop.
  // A deeply nested payload must terminate, and quickly.
  let nested = JSON.stringify({ access_token: SYNTHETIC_GHO });
  for (let depth = 0; depth < 5; depth++) nested = Buffer.from(nested).toString('base64');
  const started = Date.now();
  const sanitized = sanitizeCredentialText(`deep ${nested}`);
  assert.ok(Date.now() - started < 10_000, 'nested encoded scanning must terminate promptly');
  assert.ok(!sanitized.includes(SYNTHETIC_GHO), 'nested payload must not expose the credential');
}

{
  // The encoded sanitizer must be inert without a plaintext detector rather
  // than throwing or silently redacting everything.
  const text = `blob ${Buffer.from(JSON.stringify({ token: SYNTHETIC_GHO })).toString('base64')}`;
  assert.equal(sanitizeEncodedCredentials(text, {}), text, 'no detector means no changes');
  assert.equal(sanitizeEncodedCredentials('', { sanitizePlaintext: value => value }), '', 'empty input must be handled');
}

{
  // Root cause class 3: line-wrapped base64. Every wrapper in common use folds
  // its output — `base64(1)` and MIME at 76 columns, PEM and `openssl` at 64 —
  // and a folded blob has no single-line run for the encoded detector to match,
  // so it passed straight through. Each wrap width must be caught.
  const payload = JSON.stringify({ token: SYNTHETIC_GHO, note: 'keep me' });
  const encoded = Buffer.from(payload).toString('base64');
  for (const width of [20, 64, 76]) {
    const wrapped = encoded.replace(new RegExp(`(.{${width}})`, 'g'), '$1\n').replace(/\n$/, '');
    assert.ok(wrapped.includes('\n'), `fixture for width ${width} must actually wrap`);

    const sanitized = sanitizeCredentialText(`response body=${wrapped}\nnext line\n`);
    assertAbsent(sanitized, [SYNTHETIC_GHO, wrapped, encoded], `wrapped base64 at width ${width} must be masked`);
    assert.ok(sanitized.includes('next line'), 'surrounding records must survive');

    // CRLF is what a Windows runner writes, and the indented form is what a
    // pretty-printer emits; both must fold to the same payload.
    const crlf = wrapped.replace(/\n/g, '\r\n');
    assertAbsent(sanitizeCredentialText(`body=${crlf}\r\n`), [SYNTHETIC_GHO, crlf], `CRLF-wrapped base64 at width ${width} must be masked`);
    const indented = wrapped.replace(/\n/g, '\n    ');
    assertAbsent(sanitizeCredentialText(`body=${indented}\n`), [SYNTHETIC_GHO, indented], `indented wrapped base64 at width ${width} must be masked`);
  }

  // Known-token matching must work on a wrapped blob even when the payload has
  // no recognisable format of its own — exact value, not pattern.
  const opaque = Buffer.from(`prefix ${SYNTHETIC_GHO} suffix`).toString('base64');
  const wrappedOpaque = opaque.replace(/(.{24})/g, '$1\n').replace(/\n$/, '');
  assert.ok(findEncodedKnownTokenRuns(`x\n${wrappedOpaque}\n`, KNOWN_TOKENS).length > 0, 'wrapped known tokens must be located');

  // Prose must not be mistaken for a wrapped blob: consecutive long words are
  // the shape a fold produces, and a false positive here would corrupt logs.
  const prose = 'transformation pipeline\nconfiguration management\nreproducible builds\n';
  assert.equal(sanitizeCredentialText(prose), prose, 'consecutive long words must not be treated as wrapped base64');
}

{
  // The stdio interceptor sanitizes a stream record by record, but a wrapped
  // blob is one credential carrier spread across many records. Released one at
  // a time, each line decodes to byte-misaligned noise and nothing matches, so
  // a trailing group of base64-only lines is held back until a line that cannot
  // belong to the blob arrives.
  const encoded = Buffer.from(JSON.stringify({ token: SYNTHETIC_GHO, note: 'keep me' })).toString('base64');
  for (const width of [20, 64, 76]) {
    const wrapped = encoded.replace(new RegExp(`(.{${width}})`, 'g'), '$1\n').replace(/\n$/, '');
    const text = `start of output\nresponse body=\n${wrapped}\ntrailing line\n`;
    const whole = sanitizeCredentialText(text);
    // Chunk sizes deliberately unaligned to the record and wrap boundaries.
    for (const chunk of [1, 5, 21, 4096]) {
      const stream = createCredentialStreamSanitizer();
      let output = '';
      for (let offset = 0; offset < text.length; offset += chunk) output += stream.write(text.slice(offset, offset + chunk));
      output += stream.flush();
      assertAbsent(output, [SYNTHETIC_GHO, wrapped], `streamed wrapped base64 (width ${width}, chunk ${chunk}) must be masked`);
      assert.equal(output, whole, `streaming must match whole-text sanitization (width ${width}, chunk ${chunk})`);
    }
  }

  // Holding back must not cost latency on ordinary output. A complete record
  // that cannot start a wrapped blob is released by the same write that
  // completes it — including the URL- and path-heavy lines this tool prints,
  // whose tails are made entirely of base64 alphabet characters.
  for (const line of ['hello world\n', 'see https://gist.github.com/konard/63a67ea16390b5f0c819e3d5ca749693\n', '[STDOUT] /tmp/gh-issue-solver-1786621862337/src/lib.mjs\n']) {
    assert.equal(createCredentialStreamSanitizer().write(line), line, `plain record must pass through immediately: ${line.trim()}`);
  }

  // A stream that is nothing but base64 must not be buffered without bound —
  // a redirected image or a `cat` of an encoded artefact would never reach the
  // terminal. Output is released once the hold exceeds its ceiling.
  const bulk = `${Buffer.from('x'.repeat(768 * 1024))
    .toString('base64')
    .replace(/(.{76})/g, '$1\n')}\n`;
  const bulkStream = createCredentialStreamSanitizer();
  assert.ok(bulkStream.write(bulk).length > 0, 'an unbounded base64 stream must still be released');
}

{
  // Availability of the fail-closed path. `SENSITIVE_KEY` allowed unbounded
  // `[A-Za-z0-9_.-]` on both sides of the keyword, so the assignment rules
  // retried from every offset of a long unbroken run: 64 KB took 38 s and a
  // 553 KB blob never finished. Publication sanitizes before it releases
  // anything, so that is a hang, not a slowdown.
  const started = Date.now();
  const sanitized = sanitizeCredentialText(`payload=${'A'.repeat(256 * 1024)}`);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 20_000, `long unbroken runs must sanitize in linear time (took ${elapsed}ms)`);
  assert.ok(sanitized.length > 0, 'output must still be produced');

  // Bounding the affixes must not cost coverage: keys are still matched with
  // realistic prefixes and suffixes around the keyword.
  for (const key of ['api_key', 'GITHUB_TOKEN', 'x-api-key', 'my_service_api_key_v2']) {
    const text = `${key}=${SYNTHETIC_GHO}`;
    assert.ok(!sanitizeCredentialText(text).includes(SYNTHETIC_GHO), `assignment to ${key} must still be masked`);
  }
}

console.log('encoded credential leak tests passed (issue #2156)');
