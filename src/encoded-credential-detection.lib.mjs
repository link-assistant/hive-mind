/**
 * Encoding-aware credential detection (issue #2156).
 *
 * Every sanitizer layer that existed before this module — the maintained regex
 * core, the custom named patterns, Secretlint, and the known-local-token
 * registry — matches credentials in their *plaintext* representation only.
 *
 * That is not sufficient. The leak documented in
 * `docs/case-studies/issue-2156/analysis.md` happened because a GitHub CLI
 * OAuth token was exchanged at `https://ghcr.io/token`, and GHCR echoes the
 * supplied credential back inside a JSON body **base64-encoded**:
 *
 *     {"token":"Z2h...<base64 of the caller's gho_ token>...=="}
 *
 * No plaintext `gho_` substring exists anywhere in that payload, so every
 * detector passed it through. GitHub's own secret scanning *does* decode
 * base64, detected the credential in the published gist, and revoked it.
 *
 * This module closes that class of gap with two independent strategies:
 *
 *   A. `findEncodedKnownTokenRuns` — exact matching. For a credential whose
 *      value we already hold locally, derive every encoded representation of
 *      it (base64/base64url at all three byte alignments, hex, percent, JS/
 *      JSON unicode escapes, HTML entities) and locate those. Zero false
 *      positives by construction: we are searching for a transform of a
 *      string we know verbatim.
 *
 *   B. `findEncodedSecretRuns` — generic decode-and-rescan. Locate encoded
 *      runs of any kind, decode them (recursively, to a bounded depth), and
 *      hand the decoded bytes back to the caller's plaintext detector. This
 *      catches encoded credentials we do *not* hold locally, which is the
 *      case for any third-party service response.
 *
 * The module is deliberately dependency-free and synchronous so that
 * `credential-sanitization-core.lib.mjs` — which is itself used by the
 * lowest-level stream sanitizer — can call it without an import cycle or an
 * async hop.
 *
 * @module encoded-credential-detection
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Shortest encoded run worth decoding. A 16-character credential is 24
 * base64 characters, so anything below this cannot carry a credential of a
 * length we would mask in the first place (`maskToken` emits `[REDACTED]` at
 * or below 12 characters).
 */
const MIN_ENCODED_RUN_LENGTH = 24;

/**
 * Upper bound on a single decoded payload. Published logs embed multi-megabyte
 * base64 blobs (screenshots, session snapshots); decoding those in full costs
 * far more than the detection is worth, and a credential is never megabytes
 * long. Runs above this are still *scanned* — we decode a bounded prefix and
 * suffix rather than skipping the run entirely (see `decodeBase64Bounded`).
 */
const MAX_DECODE_BYTES = 256 * 1024;

/** How many times to peel nested encodings (base64 of base64 of ...). */
const MAX_DECODE_DEPTH = 3;

/**
 * Minimum share of decoded bytes that must be printable ASCII before we run
 * plaintext credential rules over them. Binary payloads (PNG, gzip, protobuf)
 * decode to noise; running context-sensitive rules such as `password=` over
 * that noise produces false positives without protecting anything. Structured
 * credentials are always printable text.
 */
const MIN_PRINTABLE_RATIO = 0.9;

// ---------------------------------------------------------------------------
// Run patterns
// ---------------------------------------------------------------------------

// Standard base64 and URL-safe base64 share one scan; `decodeBase64Bounded`
// normalizes the alphabet before decoding.
//
// These are stored as source strings rather than RegExp instances on purpose.
// Scanning recurses — sanitizing a decoded payload rescans it for further
// encoded runs — and a shared `/g` RegExp carries mutable `lastIndex` state,
// so a nested scan would rewind the enclosing one and loop forever. Every scan
// compiles its own instance via `matchRuns`.
const BASE64_RUN = `[A-Za-z0-9+/_-]{${MIN_ENCODED_RUN_LENGTH},}={0,2}`;
const HEX_RUN = String.raw`\b[0-9a-fA-F]{32,}\b`;

// Percent-encoding leaves unreserved characters alone, and every character a
// GitHub token is made of is unreserved. `encodeURIComponent(JSON.stringify(…))`
// therefore yields `%7B%22access_token%22%3A%22gho_…%22%7D`: the punctuation is
// escaped, the credential is not, and the escapes are never consecutive. A run
// must be allowed to interleave unreserved characters or the credential is
// never reached. Anchoring the run at a `%` keeps scanning linear — the engine
// only ever starts matching at an escape — and {@link hasEnoughEscapes} then
// discards runs that are really just prose with one stray escape in them.
const PERCENT_ESCAPE = String.raw`%[0-9a-fA-F]{2}`;
const PERCENT_UNRESERVED = String.raw`[A-Za-z0-9._~!*'()-]`;
const PERCENT_RUN = `${PERCENT_ESCAPE}(?:${PERCENT_ESCAPE}|${PERCENT_UNRESERVED})*`;

const ESCAPE_RUN = String.raw`(?:\\u00[0-9a-fA-F]{2}|\\x[0-9a-fA-F]{2}){8,}`;
const ENTITY_RUN = String.raw`(?:&#x?[0-9a-fA-F]{1,5};){8,}`;

/** Escapes a percent-encoded run needs before it is worth decoding. */
const MIN_PERCENT_ESCAPES = 4;

/**
 * Reject percent-runs that are ordinary text carrying an incidental escape
 * (`%20` in a URL path, a `%2F` in a query string).
 *
 * @param {string} run
 * @returns {boolean}
 */
const hasEnoughEscapes = run => (run.match(/%[0-9a-fA-F]{2}/g) || []).length >= MIN_PERCENT_ESCAPES;

/**
 * Collect every match of `source` in `text` up front, before any callback can
 * run. Materializing the list first keeps recursive scanning safe.
 *
 * @param {string} text
 * @param {string} source regular-expression source
 * @returns {Array<{run: string, index: number}>}
 */
const matchRuns = (text, source) => {
  const pattern = new RegExp(source, 'g');
  const runs = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    runs.push({ run: match[0], index: match.index });
    if (match[0].length === 0) pattern.lastIndex++;
  }
  return runs;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isPrintableByte = code => code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);

/**
 * Bytes → text for the byte-oriented encodings (base64, hex).
 *
 * UTF-8 rather than latin1, so that a decoded payload can be sanitized and
 * re-encoded byte-identically. Masked values contain `…`, which latin1 cannot
 * represent; encoding it back under latin1 silently produced different bytes,
 * the round-trip check then failed, and every hit degraded to wholesale
 * redaction. Binary blobs decode to replacement characters either way and are
 * rejected by {@link printableRatio} before any rule sees them.
 *
 * @param {Buffer} bytes
 * @returns {string}
 */
const decodeBytes = bytes => bytes.toString('utf8');

/**
 * Text → bytes, the inverse of {@link decodeBytes}.
 *
 * @param {string} text
 * @returns {Buffer}
 */
const encodeBytes = text => Buffer.from(text, 'utf8');

/**
 * Share of printable ASCII in a decoded string. Used to reject binary blobs
 * before applying text-oriented credential rules.
 *
 * @param {string} text
 * @returns {number} ratio in [0, 1]; an empty string scores 0
 */
export const printableRatio = text => {
  if (!text || text.length === 0) return 0;
  let printable = 0;
  for (let index = 0; index < text.length; index++) {
    if (isPrintableByte(text.charCodeAt(index))) printable++;
  }
  return printable / text.length;
};

/**
 * Decode a base64 / base64url run, bounding the work for very large blobs.
 *
 * A credential embedded in a huge payload is still worth finding, so instead
 * of skipping oversized runs we decode a prefix and a suffix. The prefix and
 * suffix are cut on 4-character boundaries so both decode correctly.
 *
 * @param {string} run
 * @returns {string|null} decoded text, or null when the run is not decodable
 *   as base64
 */
const decodeBase64Bounded = run => {
  const normalized = run.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  // A run made only of `-`/`_` (a hyphenated identifier, a snake_case name)
  // normalizes to `+`/`/` and carries no information. Require a real mix.
  if (!/[A-Za-z0-9]/.test(normalized)) return null;
  // Lengths of 2 and 3 (mod 4) are valid — they encode 1 and 2 trailing bytes.
  // Only a remainder of 1 is impossible, and dropping more than that would
  // lose the final bytes and make the re-encode round trip fail for every
  // padded run, which is the overwhelmingly common case.
  const usable = normalized.length % 4 === 1 ? normalized.slice(0, normalized.length - 1) : normalized;
  if (usable.length < MIN_ENCODED_RUN_LENGTH) return null;

  const maxChars = Math.floor((MAX_DECODE_BYTES * 4) / 3 / 4) * 4;
  try {
    if (usable.length <= maxChars) {
      return decodeBytes(Buffer.from(usable, 'base64'));
    }
    const half = Math.floor(maxChars / 2 / 4) * 4;
    const head = decodeBytes(Buffer.from(usable.slice(0, half), 'base64'));
    const tailStart = usable.length - half - ((usable.length - half) % 4);
    const tail = decodeBytes(Buffer.from(usable.slice(tailStart), 'base64'));
    // The join is not a real byte boundary, so separate the two halves with a
    // newline. That prevents a rule from matching across the seam and
    // reporting a credential that does not exist.
    return `${head}\n${tail}`;
  } catch {
    return null;
  }
};

const decodeHex = run => {
  if (run.length % 2 !== 0) return null;
  try {
    return decodeBytes(Buffer.from(run.slice(0, Math.min(run.length, MAX_DECODE_BYTES * 2)), 'hex'));
  } catch {
    return null;
  }
};

const decodePercent = run => {
  try {
    return decodeURIComponent(run);
  } catch {
    // A malformed sequence still yields useful bytes when decoded manually.
    return run.replace(/%([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
};

const decodeEscapes = run => run.replace(/\\u00([0-9a-fA-F]{2})|\\x([0-9a-fA-F]{2})/g, (_match, unicodeHex, hexHex) => String.fromCharCode(parseInt(unicodeHex || hexHex, 16)));

const decodeEntities = run =>
  run.replace(/&#(x?)([0-9a-fA-F]{1,5});/g, (match, hexMarker, digits) => {
    const code = parseInt(digits, hexMarker ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });

// ---------------------------------------------------------------------------
// Encoders (used to rebuild a run after its decoded content was sanitized)
// ---------------------------------------------------------------------------

/**
 * Re-encode `text` the way `run` was encoded, so a sanitized payload can be
 * substituted back in place without disturbing the surrounding format. The
 * original run is inspected to preserve the URL-safe alphabet and padding.
 *
 * @param {string} text decoded, already-sanitized content
 * @param {string} run the original encoded run
 * @returns {string}
 */
const encodeBase64Like = (text, run) => {
  const urlSafe = /[-_]/.test(run) && !/[+/]/.test(run);
  let encoded = encodeBytes(text).toString('base64');
  if (urlSafe) encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_');
  if (!/=$/.test(run)) encoded = encoded.replace(/=+$/, '');
  return encoded;
};

const encodeHex = (text, run) => {
  const encoded = encodeBytes(text).toString('hex');
  return /[A-F]/.test(run) && !/[a-f]/.test(run) ? encoded.toUpperCase() : encoded;
};

const encodePercent = text => [...encodeBytes(text)].map(byte => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`).join('');

// Byte escapes carry latin1 semantics: `\u00XX` is one character per escape.
// A masked value contains `…`, which has no single-byte form, so the round-trip
// check rejects the rebuilt run and the caller redacts it whole instead.
const encodeEscapes = (text, run) => [...Buffer.from(text, 'latin1')].map(byte => (/\\u/.test(run) ? `\\u00${byte.toString(16).padStart(2, '0')}` : `\\x${byte.toString(16).padStart(2, '0')}`)).join('');

const encodeEntities = (text, run) => [...text].map(char => (/&#x/.test(run) ? `&#x${char.codePointAt(0).toString(16)};` : `&#${char.codePointAt(0)};`)).join('');

// `accept` is an optional per-encoding gate applied to a matched run before it
// is decoded, for conditions a regular expression cannot express.
const DECODERS = Object.freeze([
  { encoding: 'base64', pattern: BASE64_RUN, decode: decodeBase64Bounded, encode: encodeBase64Like },
  { encoding: 'hex', pattern: HEX_RUN, decode: decodeHex, encode: encodeHex },
  { encoding: 'percent', pattern: PERCENT_RUN, decode: decodePercent, encode: encodePercent, accept: hasEnoughEscapes },
  { encoding: 'escape', pattern: ESCAPE_RUN, decode: decodeEscapes, encode: encodeEscapes },
  { encoding: 'entity', pattern: ENTITY_RUN, decode: decodeEntities, encode: encodeEntities },
]);

// ---------------------------------------------------------------------------
// Strategy A — encoded representations of a credential we already hold
// ---------------------------------------------------------------------------

/**
 * Base64 fragments of `value` that survive being embedded at an arbitrary
 * byte offset inside a larger payload.
 *
 * base64 maps each aligned group of 3 input bytes onto 4 output characters.
 * When `value` starts at byte offset `k` of the payload, only the groups that
 * lie entirely inside `value` are determined by `value` alone; the groups that
 * straddle its edges also depend on the neighbouring bytes and therefore
 * cannot be predicted. Encoding `value` at each of the three possible
 * alignments and keeping just the fully-determined interior gives three
 * fragments, at least one of which appears verbatim in any base64 payload that
 * contains `value`.
 *
 * @param {string} value plaintext credential
 * @returns {Array<string>} distinct alignment-stable fragments
 */
export const base64AlignmentFragments = value => {
  const bytes = Buffer.from(String(value ?? ''), 'utf8');
  if (bytes.length < 12) return [];

  const fragments = new Set();
  for (let alignment = 0; alignment < 3; alignment++) {
    const padded = Buffer.concat([Buffer.alloc(alignment, 0x41), bytes, Buffer.alloc(2, 0x41)]);
    const encoded = padded.toString('base64');
    const firstGroup = Math.ceil(alignment / 3);
    const lastGroup = Math.floor((alignment + bytes.length) / 3) - 1;
    if (lastGroup < firstGroup) continue;
    const fragment = encoded.slice(firstGroup * 4, (lastGroup + 1) * 4);
    // Below 16 characters a fragment stops being specific enough to assert a
    // credential match on its own.
    if (fragment.length >= 16) fragments.add(fragment);
  }
  return [...fragments];
};

/**
 * Every encoded representation of `value` that we know how to look for.
 *
 * @param {string} value plaintext credential
 * @returns {Array<{encoding: string, needle: string}>}
 */
export const encodedRepresentations = value => {
  const text = String(value ?? '');
  if (text.length < 12) return [];
  const buffer = Buffer.from(text, 'utf8');
  const representations = [];

  for (const fragment of base64AlignmentFragments(text)) {
    representations.push({ encoding: 'base64', needle: fragment });
    // URL-safe base64 uses the same layout with a different alphabet, so the
    // alignment fragments translate directly.
    const urlSafe = fragment.replace(/\+/g, '-').replace(/\//g, '_');
    if (urlSafe !== fragment) representations.push({ encoding: 'base64url', needle: urlSafe });
  }

  const hex = buffer.toString('hex');
  representations.push({ encoding: 'hex', needle: hex });
  representations.push({ encoding: 'hex-upper', needle: hex.toUpperCase() });

  representations.push({ encoding: 'percent', needle: encodeURIComponent(text) });
  representations.push({
    encoding: 'percent-full',
    needle: [...buffer].map(byte => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`).join(''),
  });

  representations.push({
    encoding: 'unicode-escape',
    needle: [...text].map(char => `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`).join(''),
  });
  representations.push({
    encoding: 'hex-escape',
    needle: [...buffer].map(byte => `\\x${byte.toString(16).padStart(2, '0')}`).join(''),
  });
  representations.push({
    encoding: 'html-entity',
    needle: [...text].map(char => `&#${char.codePointAt(0)};`).join(''),
  });

  // Drop anything that degenerates to the plaintext itself (already handled by
  // the verbatim layer) or that is too short to assert on.
  return representations.filter(({ needle }) => needle.length >= 16 && needle !== text);
};

const BASE64_CHARACTER = /[A-Za-z0-9+/=_-]/;

/**
 * Widen `[start, end)` to cover the complete encoded run it sits inside, so
 * masking removes the whole credential rather than the predictable middle of
 * it.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {RegExp} characterClass
 * @returns {{start: number, end: number}}
 */
const expandRun = (text, start, end, characterClass) => {
  let from = start;
  let to = end;
  while (from > 0 && characterClass.test(text[from - 1])) from--;
  while (to < text.length && characterClass.test(text[to])) to++;
  return { start: from, end: to };
};

const CHARACTER_CLASS_FOR_ENCODING = {
  base64: BASE64_CHARACTER,
  base64url: BASE64_CHARACTER,
  hex: /[0-9a-fA-F]/,
  'hex-upper': /[0-9a-fA-F]/,
  percent: /[%0-9a-fA-F]/,
  'percent-full': /[%0-9a-fA-F]/,
  'unicode-escape': /[\\u0-9a-fA-F]/,
  'hex-escape': /[\\x0-9a-fA-F]/,
  'html-entity': /[&#;0-9a-fA-Fx]/,
};

/**
 * Locate encoded occurrences of known credential values in `text`.
 *
 * @param {string} text
 * @param {Array<string|{value: string}>} knownTokens
 * @returns {Array<{start: number, end: number, encoding: string, value: string}>}
 *   ranges sorted by descending start so callers can splice without
 *   recomputing offsets
 */
export const findEncodedKnownTokenRuns = (text, knownTokens = []) => {
  const content = String(text ?? '');
  if (content.length === 0) return [];

  const found = [];
  for (const entry of knownTokens) {
    const value = typeof entry === 'string' ? entry : entry?.value;
    if (typeof value !== 'string' || value.length < 12) continue;

    for (const { encoding, needle } of encodedRepresentations(value)) {
      let index = content.indexOf(needle);
      while (index !== -1) {
        const characterClass = CHARACTER_CLASS_FOR_ENCODING[encoding] || BASE64_CHARACTER;
        const range = expandRun(content, index, index + needle.length, characterClass);
        found.push({ ...range, encoding, value });
        index = content.indexOf(needle, index + needle.length);
      }
    }
  }

  return dedupeRanges(found);
};

/**
 * Collapse overlapping ranges, keeping the widest, and sort descending by
 * start so that splicing from the end never invalidates a later offset.
 *
 * @param {Array<{start: number, end: number}>} ranges
 * @returns {Array<{start: number, end: number}>}
 */
const dedupeRanges = ranges => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start < previous.end) {
      if (range.end > previous.end) previous.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }
  return merged.reverse();
};

// ---------------------------------------------------------------------------
// Strategy B — generic decode-and-rescan
// ---------------------------------------------------------------------------

/**
 * Locate encoded runs whose decoded content a plaintext detector considers a
 * credential.
 *
 * The detector is injected rather than imported so this module stays free of
 * project dependencies and so callers can decide how aggressive the plaintext
 * rules should be. `detect` receives decoded text and returns a truthy rule
 * identifier (or `true`) when that text contains a credential.
 *
 * @param {string} text
 * @param {(decoded: string) => (string|boolean)} detect
 * @param {Object} [options]
 * @param {number} [options.maxDepth] nested-encoding peel limit
 * @returns {Array<{start: number, end: number, encoding: string, depth: number, ruleId: string}>}
 *   ranges sorted by descending start
 */
export const findEncodedSecretRuns = (text, detect, options = {}) => {
  const content = String(text ?? '');
  if (content.length === 0 || typeof detect !== 'function') return [];
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : MAX_DECODE_DEPTH;

  const found = [];

  for (const { encoding, pattern, decode, accept } of DECODERS) {
    for (const { run, index } of matchRuns(content, pattern)) {
      if (run.length < MIN_ENCODED_RUN_LENGTH) continue;
      if (accept && !accept(run)) continue;

      const hit = scanDecoded(run, decode, detect, maxDepth);
      if (hit) {
        found.push({ start: index, end: index + run.length, encoding, depth: hit.depth, ruleId: hit.ruleId });
      }
    }
  }

  return dedupeRanges(found);
};

/**
 * Peel nested encodings off `run`, testing each decoded layer.
 *
 * @param {string} run
 * @param {(run: string) => (string|null)} decode first-layer decoder
 * @param {(decoded: string) => (string|boolean)} detect
 * @param {number} maxDepth
 * @returns {{depth: number, ruleId: string}|null}
 */
const scanDecoded = (run, decode, detect, maxDepth) => {
  let current = decode(run);
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (typeof current !== 'string' || current.length === 0) return null;
    // Text-oriented rules over binary noise report credentials that are not
    // there. A real encoded credential always decodes to printable text.
    if (printableRatio(current) >= MIN_PRINTABLE_RATIO) {
      const verdict = detect(current);
      if (verdict) return { depth, ruleId: typeof verdict === 'string' ? verdict : 'encoded-credential' };
    }
    if (depth === maxDepth) return null;
    // Peel one more layer: the decoded text may itself be an encoded blob.
    const inner = current.trim();
    if (inner.length < MIN_ENCODED_RUN_LENGTH || !/^[A-Za-z0-9+/=_-]+$/.test(inner)) return null;
    current = decodeBase64Bounded(inner);
  }
  return null;
};

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * Mask credentials that are present in `input` only in encoded form.
 *
 * A run is considered to carry a credential when recursively sanitizing its
 * *decoded* content changes that content. Formulating detection as "the
 * plaintext sanitizer has something to say about this" means the encoded layer
 * automatically inherits every present and future plaintext rule, instead of
 * maintaining a second, drifting copy of the rule set.
 *
 * Where possible the sanitized payload is re-encoded in the original encoding
 * and substituted back, so a base64 blob that merely *contains* a credential
 * keeps all of its other fields intact and stays parseable. The re-encoded
 * value is verified by decoding it again before it is used; if the round trip
 * does not reproduce the sanitized bytes exactly, the whole run is replaced
 * with `[REDACTED]` instead. Failing towards total redaction keeps a partially
 * understood payload from being published.
 *
 * @param {string} input
 * @param {Object} options
 * @param {(text: string) => string} options.sanitizePlaintext recursive
 *   sanitizer applied to decoded content
 * @param {Array<string|{value: string}>} [options.knownTokens] credential
 *   values we hold locally; their encoded forms are matched exactly, without
 *   relying on the decode step
 * @param {string} [options.redactedMarker]
 * @returns {string}
 */
export const sanitizeEncodedCredentials = (input, options = {}) => {
  const text = String(input ?? '');
  const { sanitizePlaintext, knownTokens = [], redactedMarker = '[REDACTED]' } = options;
  if (text.length === 0 || typeof sanitizePlaintext !== 'function') return text;

  const replacements = [];

  for (const { pattern, decode, encode, accept } of DECODERS) {
    for (const { run, index } of matchRuns(text, pattern)) {
      if (run.length < MIN_ENCODED_RUN_LENGTH) continue;
      if (accept && !accept(run)) continue;

      const decoded = decode(run);
      // Text rules over binary noise report credentials that are not there.
      // A genuinely encoded credential always decodes to printable text.
      if (typeof decoded !== 'string' || decoded.length === 0) continue;
      if (printableRatio(decoded) < MIN_PRINTABLE_RATIO) continue;

      const sanitized = sanitizePlaintext(decoded);
      if (sanitized === decoded) continue;

      let replacement = redactedMarker;
      const reEncoded = encode(sanitized, run);
      // Only substitute a rebuilt run when it provably decodes back to exactly
      // what we intended to publish.
      if (decode(reEncoded) === sanitized) replacement = reEncoded;

      replacements.push({ start: index, end: index + run.length, replacement });
    }
  }

  // Exact encoded forms of credentials we already hold are matched without
  // decoding, which also covers runs too large to decode in full.
  for (const { start, end } of findEncodedKnownTokenRuns(text, knownTokens)) {
    replacements.push({ start, end, replacement: redactedMarker });
  }

  if (replacements.length === 0) return text;

  // Splice from the end so earlier offsets stay valid. Overlaps collapse to
  // the widest range, and total redaction wins over a rebuilt run.
  const ordered = [...replacements].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const item of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && item.start < previous.end) {
      previous.end = Math.max(previous.end, item.end);
      if (item.replacement === redactedMarker || previous.replacement === redactedMarker) {
        previous.replacement = redactedMarker;
      }
      continue;
    }
    merged.push({ ...item });
  }

  let output = text;
  for (const { start, end, replacement } of merged.reverse()) {
    output = output.slice(0, start) + replacement + output.slice(end);
  }
  return output;
};

/**
 * Non-sensitive report of encoded credential material still present in `input`.
 * Callers never receive the matching value.
 *
 * @param {string} input
 * @param {Object} options same shape as {@link sanitizeEncodedCredentials}
 * @returns {Array<{ruleId: string}>}
 */
export const findEncodedCredentialResiduals = (input, options = {}) => {
  const text = String(input ?? '');
  return sanitizeEncodedCredentials(text, options) === text ? [] : [{ ruleId: 'encoded-credential' }];
};

export default {
  base64AlignmentFragments,
  encodedRepresentations,
  findEncodedKnownTokenRuns,
  findEncodedSecretRuns,
  findEncodedCredentialResiduals,
  sanitizeEncodedCredentials,
  printableRatio,
};
