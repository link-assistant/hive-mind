#!/usr/bin/env node
/**
 * Issue #2156 — how much of the problem does a base64-shaped *regex* cover?
 *
 * GitHub announced base64-encoded token detection on 2025-02-14, for exactly
 * the credential class that leaked here. The tempting conclusion is to copy the
 * pattern instead of decoding. The pattern circulating for it — quoted by
 * Secretlint's maintainer in secretlint/secretlint#19 — is:
 *
 *   /(Z2hw|Z2hv|Z2h1|Z2hz|Z2hy)Xz[A-Za-z0-9+\/]{48}={0,2}/
 *
 * This script measures what that actually catches, because the answer decides
 * whether pattern-matching the encoding is a viable strategy at all.
 *
 * Two independent limits fall out, and both are arithmetic rather than
 * incidental:
 *
 *   1. It reads byte alignment 0 only. Base64 of a blob that merely *contains*
 *      a token starts the token at whichever of three alignments it lands on,
 *      and the other two produce entirely different characters.
 *   2. Even at alignment 0 it requires the base64 pair `Xz`, which pins the
 *      *fifth character of the token* — the one after `gho_`. `_` is 0x5F, so
 *      the second sextet is 0x30 | (c5 >> 4): the pair is `Xz` only when
 *      c5 >> 4 == 3, i.e. c5 in 0x30–0x3F. For a token body drawn from
 *      [A-Za-z0-9] that is the ten digits out of sixty-two characters.
 *
 * SYNTHETIC TOKENS ONLY. Every value here is generated, never a real one.
 */

const QUOTED = /(Z2hw|Z2hv|Z2h1|Z2hz|Z2hy)Xz[A-Za-z0-9+/]{48}={0,2}/;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const base64 = value => Buffer.from(value).toString('base64');

/** A synthetic 40-character `gho_` token whose body starts with `first`. */
const token = first => `gho_${first}${'B'.repeat(35)}`;

console.log('Coverage of the quoted base64 pattern\n');

// 1. Which token bodies match, at alignment 0.
const matchedFirstChars = [...ALPHABET].filter(character => QUOTED.test(base64(token(character))));
console.log(`alignment 0, by 5th character of the token:`);
console.log(`  matched   ${matchedFirstChars.length}/${ALPHABET.length} — ${matchedFirstChars.join('') || '(none)'}`);
console.log(`  coverage  ${((matchedFirstChars.length / ALPHABET.length) * 100).toFixed(1)}% of uniformly distributed tokens\n`);

// 2. What the other two alignments do, using a body the pattern does match at
//    alignment 0 so that alignment is the only variable.
const matchable = token(matchedFirstChars[0] ?? '0');
console.log(`byte alignment, for a token the pattern does match at 0:`);
for (const offset of [0, 1, 2]) {
  const encoded = base64(`${'x'.repeat(offset)}${matchable}`);
  console.log(`  offset ${offset}: ${encoded.slice(0, 12)}…  match=${QUOTED.test(encoded)}`);
}

// 3. And the combination, which is what a log actually contains: a token
//    embedded in a JSON body, at whatever alignment the prefix imposes.
console.log(`\nembedded in a JSON body (the incident shape), across alignments:`);
let embeddedMatches = 0;
let embeddedTotal = 0;
for (const character of ALPHABET) {
  for (const prefix of ['', ' ', '  ']) {
    embeddedTotal += 1;
    if (QUOTED.test(base64(`${prefix}{"token":"${token(character)}"}`))) embeddedMatches += 1;
  }
}
console.log(`  matched   ${embeddedMatches}/${embeddedTotal}`);

console.log(`\nDecoding, by contrast, is indifferent to both variables: the token is
found whenever the run decodes, whatever its body and wherever it sits.`);
