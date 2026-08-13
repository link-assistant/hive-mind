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

// Base64 is very often *wrapped*: the `base64` CLI breaks its output at 76
// characters by default, MIME bodies wrap at 76, PEM at 64, and pretty-printed
// JSON viewers wrap at whatever the terminal is. A wrapped blob defeats
// {@link BASE64_RUN} completely — each line is matched as a separate run, and
// an individual line is a byte-misaligned slice that decodes to noise, so the
// printable-ratio gate discards it and the credential inside is never seen.
//
// Matching the wrapped form as one run and folding the whitespace out before
// decoding restores the blob. Lines are required to be substantial so that two
// consecutive short words of prose cannot be mistaken for a wrapped blob.
// A wrapped run is found by locating its *interior* — the lines that consist of
// nothing but base64 — and then expanding outwards over the partial first line
// (`body=AAAA…`) and the short remainder line that ends the blob.
//
// The alternative, one regular expression describing the whole shape, is
// ruinously slow. It can begin matching at any base64 character, which in a
// 17 MB log is most of the file: 2235 ms per scan, against 23 ms for the
// line-anchored form below, for identical results.
const MIN_WRAPPED_LINE_LENGTH = 16;
const WRAPPED_FULL_LINE = String.raw`(\r?\n)([ \t]*)([A-Za-z0-9+/_-]{${MIN_WRAPPED_LINE_LENGTH},}={0,2})[ \t]*(?=\r?\n|$)`;
const WRAPPED_TAIL_LINE = new RegExp(String.raw`^[ \t]*\r?\n[ \t]*[A-Za-z0-9+/_-]{1,${MIN_WRAPPED_LINE_LENGTH - 1}}={0,2}(?=[ \t]*(?:\r?\n|$))`);
const BASE64_LINE_CHARACTER = /[A-Za-z0-9+/_-]/;

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
const runsOf = (decoder, text) => (decoder.findRuns ? decoder.findRuns(text) : matchRuns(text, decoder.pattern));

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

/**
 * Whether the short line following a group of base64 lines is the payload's
 * remainder or an unrelated record.
 *
 * Both readings are syntactically valid — `done`, `OK` and `tail` are as much
 * base64 as any remainder — so the question is settled by decoding. Appending a
 * genuine remainder extends printable text with printable text; appending an
 * unrelated word appends bytes that decode to noise. Absorbing the wrong line
 * deletes it from the log, so anything that lowers printability is rejected.
 *
 * @param {string} group the base64-only lines, as found
 * @param {string} tail the candidate remainder line, including its separator
 * @returns {boolean}
 */
const tailContinuesPayload = (group, tail) => {
  const folded = foldWhitespace(group);
  const extended = folded + foldWhitespace(tail);
  // `=` padding terminates a payload, so nothing can follow it. This has to be
  // checked explicitly: decoders ignore whatever comes after the padding, so
  // the printability comparison below sees two identical decodes and absorbs a
  // line that was never part of the blob.
  if (folded.endsWith('=')) return false;

  // Every wrapper we have seen emits canonical, padded base64, whose total
  // length is a multiple of 4. A remainder that does not complete the payload
  // to that boundary is a different record — `OK` decodes to a printable byte
  // and would otherwise pass the check below.
  if (extended.length % 4 !== 0) return false;
  return printableRatio(decodeBase64Bounded(extended)) >= printableRatio(decodeBase64Bounded(folded));
};

/**
 * Locate wrapped base64 blobs: two or more lines that together form one
 * encoded payload.
 *
 * Matching starts from complete base64-only lines, of which a log has very few,
 * and each contiguous group of them is then expanded to cover the partial line
 * it may have started on and the short remainder line it may end on.
 *
 * @param {string} text
 * @returns {Array<{run: string, index: number}>}
 */
export const findWrappedBase64Runs = text => {
  const content = String(text ?? '');
  if (content.length < MIN_WRAPPED_FOLDED_LENGTH || content.indexOf('\n') === -1) return [];

  const pattern = new RegExp(WRAPPED_FULL_LINE, 'g');
  const groups = [];
  let group = null;
  let previousEnd = -1;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const contentStart = match.index + match[1].length + match[2].length;
    const contentEnd = contentStart + match[3].length;
    // A following line is part of the same blob only when this match begins
    // exactly where the previous one stopped, i.e. no other line came between.
    if (group && match.index === previousEnd) group.end = contentEnd;
    else {
      if (group) groups.push(group);
      group = { breakStart: match.index, start: contentStart, end: contentEnd };
    }
    previousEnd = pattern.lastIndex;
  }
  if (group) groups.push(group);

  const runs = [];
  for (const { breakStart, start, end } of groups) {
    // Backwards over the partial first line. `=` is not in the class, so a
    // `body=` prefix stops the walk exactly where the payload begins.
    let from = breakStart;
    while (from > 0 && (content[from - 1] === ' ' || content[from - 1] === '\t')) from--;
    while (from > 0 && BASE64_LINE_CHARACTER.test(content[from - 1])) from--;
    if (from === breakStart) from = start;

    // Forwards over a short remainder line, which is too short to have been
    // matched as a full line of its own — but only when it really belongs to
    // the payload, since the next line of a log is very often a short word.
    let to = end;
    const tail = WRAPPED_TAIL_LINE.exec(content.slice(to));
    if (tail && tailContinuesPayload(content.slice(start, end), tail[0])) to += tail[0].length;

    const run = content.slice(from, to);
    if (run.indexOf('\n') !== -1) runs.push({ run, index: from });

    // Absorbing that first line is a guess. A preceding line made entirely of
    // base64 alphabet characters — a bare word, a path, the tail of an earlier
    // blob — is indistinguishable from a real `body=<first segment>` prefix,
    // and absorbing one that does not belong shifts the fold out of alignment
    // so the payload decodes to noise and nothing is detected at all. Offer the
    // line-aligned group as a second candidate: overlapping candidates collapse
    // to whichever one actually decodes, so the correct reading wins either way.
    if (from < start) {
      const aligned = content.slice(start, to);
      if (aligned.indexOf('\n') !== -1) runs.push({ run: aligned, index: start });
    }
  }
  return runs;
};

/**
 * Upper bound on how much of a stream may be retained while waiting to see
 * whether a run of base64-only lines ends. Output that is nothing but base64
 * (a redirected image, a `cat` of an encoded artefact) would otherwise be
 * buffered without limit and never reach the terminal.
 */
const MAX_WRAPPED_HOLD_CHARS = 256 * 1024;

/**
 * Offset from which a record-oriented sanitizer must retain `text[0, end)`
 * because its final lines may be the beginning of a wrapped base64 blob whose
 * remaining lines have not arrived yet.
 *
 * @param {string} text
 * @param {number} end offset just past the last complete record
 * @returns {number|null} offset to release up to, or null to release everything
 */
export const wrappedBase64HoldStart = (text, end) => {
  const content = String(text ?? '');
  if (end <= 0 || end > content.length) return null;

  // Step back over exactly one record separator. Doing this before each
  // backwards search is what lets the walk move from line to line: without it
  // the search starts *on* the separator it just consumed, finds itself, and
  // reports an empty line. Only one separator is skipped, so a blank line still
  // terminates the walk rather than silently joining two blobs.
  const beforeSeparator = index => {
    let at = index;
    if (at > 0 && content[at - 1] === '\n') at -= 1;
    if (at > 0 && content[at - 1] === '\r') at -= 1;
    return at;
  };

  let cursor = beforeSeparator(end);
  let lineStart = null;
  // Walk complete lines backwards for as long as each is base64 and nothing
  // else. Trailing `=` padding means the blob ended, so nothing is held.
  while (cursor > 0) {
    const separator = Math.max(content.lastIndexOf('\n', cursor - 1), content.lastIndexOf('\r', cursor - 1));
    const start = separator + 1;
    const line = content.slice(start, cursor).trim();
    if (line.length < MIN_WRAPPED_LINE_LENGTH || !/^[A-Za-z0-9+/_-]+$/.test(line)) break;
    lineStart = start;
    if (end - lineStart > MAX_WRAPPED_HOLD_CHARS) return null;
    cursor = beforeSeparator(start);
  }
  if (lineStart === null) {
    // No group yet — but the last complete line may be the one a blob *starts*
    // on, with its continuation still in flight. Expanding backwards over that
    // line (below) only works while it is still pending; once it has been
    // released there is nothing left to join the group to, and a credential
    // straddling the two is invisible to both halves. So the opening line is
    // held on its own, for exactly one record.
    const openerStart = wrappedBase64OpenerStart(content, end, beforeSeparator);
    return openerStart === null || end - openerStart > MAX_WRAPPED_HOLD_CHARS ? null : openerStart;
  }

  // The line before the group may be the partial one the blob started on — the
  // shape `body=<first segment>` takes — so it is held too. That costs one
  // extra record of latency and is released as soon as the blob ends.
  const beforeGroup = beforeSeparator(lineStart);
  const previousSeparator = Math.max(content.lastIndexOf('\n', beforeGroup - 1), content.lastIndexOf('\r', beforeGroup - 1));
  return Math.max(previousSeparator + 1, 0);
};

/**
 * Start of the last complete line in `text[0, end)` when that line looks like
 * the opening line of a wrapped base64 blob: `body=<first segment>`.
 *
 * Length alone cannot decide this. Ordinary output is full of long runs drawn
 * from the base64 alphabet — URL path segments, commit SHAs, content digests —
 * and holding every line that ends in one would add a record of latency to
 * routine terminal output. What separates them is that an encoded *payload*
 * decodes to text: the discriminator is the printable ratio of the decoded run,
 * which measures 1.00 for a JSON body and below 0.5 for a URL, a hex digest or
 * a commit SHA.
 *
 * @param {string} content
 * @param {number} end offset just past the last complete record
 * @param {(index: number) => number} beforeSeparator steps back over one record separator
 * @returns {number|null} start offset of the line to hold, or null to release
 */
const wrappedBase64OpenerStart = (content, end, beforeSeparator) => {
  const lineEnd = beforeSeparator(end);
  if (lineEnd <= 0) return null;
  const lineStart = Math.max(content.lastIndexOf('\n', lineEnd - 1), content.lastIndexOf('\r', lineEnd - 1)) + 1;
  const line = content.slice(lineStart, lineEnd).trimEnd();

  // A run that carries padding is a blob that already ended, so nothing
  // follows it and there is nothing to wait for.
  const run = /[A-Za-z0-9+/_-]+$/.exec(line)?.[0];
  if (!run || run.length < MIN_WRAPPED_LINE_LENGTH) return null;

  // Decoded directly rather than through `decodeBase64Bounded`, whose floor is
  // the 24 characters a *whole* credential needs. This run is a fragment of a
  // blob, and the fold width sets its length: `MIN_WRAPPED_LINE_LENGTH` is the
  // relevant bound, and the 20-column fold that first exposed this gap sits
  // between the two.
  const normalized = run.replace(/-/g, '+').replace(/_/g, '/');
  if (!/[A-Za-z0-9]/.test(normalized)) return null;

  // The blob may begin at any of the three byte alignments within the run, so
  // a decode that yields text at any of them is enough to hold.
  for (let alignment = 0; alignment < 4; alignment++) {
    const shifted = normalized.slice(alignment);
    const usable = shifted.length % 4 === 1 ? shifted.slice(0, -1) : shifted;
    if (usable.length < MIN_WRAPPED_LINE_LENGTH) break;
    if (printableRatio(decodeBytes(Buffer.from(usable, 'base64'))) >= MIN_PRINTABLE_RATIO) return lineStart;
  }
  return null;
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

/**
 * Remove the line structure from a wrapped base64 run, leaving the blob.
 *
 * @param {string} run
 * @returns {string}
 */
const foldWhitespace = run => run.replace(/[\s]+/g, '');

/**
 * Line layout of a wrapped run, so a rebuilt blob can be re-wrapped the same
 * way. The first line is frequently a partial one — the run starts wherever
 * `body=` ended — so the wrap width is taken from the longest line rather than
 * the first.
 *
 * @param {string} run
 * @returns {{width: number, separator: string, indent: string}}
 */
const wrappedLayout = run => {
  const separator = run.includes('\r\n') ? '\r\n' : '\n';
  const lines = run.split(/\r?\n/);
  const indentMatch = /^[ \t]*/.exec(lines[1] ?? '');
  return {
    width: Math.max(...lines.map(line => line.trim().length), MIN_WRAPPED_LINE_LENGTH),
    separator,
    indent: indentMatch ? indentMatch[0] : '',
  };
};

/**
 * Minimum folded length for a wrapped run to be worth decoding. A blob only
 * gets wrapped because it exceeded the wrap width, so anything this short is
 * two ordinary words that happened to land on consecutive lines.
 */
const MIN_WRAPPED_FOLDED_LENGTH = MIN_ENCODED_RUN_LENGTH * 2;

/**
 * Reject wrapped candidates that cannot be base64 at all. A length of 1 (mod 4)
 * is the only remainder base64 can never produce.
 *
 * @param {string} run
 * @returns {boolean}
 */
const isWrappedBase64Candidate = run => {
  const folded = foldWhitespace(run);
  return folded.length >= MIN_WRAPPED_FOLDED_LENGTH && folded.length % 4 !== 1;
};

const decodeWrappedBase64 = run => decodeBase64Bounded(foldWhitespace(run));

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

/**
 * Re-encode sanitized content and re-apply the original line layout, so a
 * wrapped blob stays wrapped — and, more importantly, so that decoding the
 * rebuilt run reproduces the sanitized bytes and the round-trip check passes.
 *
 * @param {string} text decoded, already-sanitized content
 * @param {string} run the original wrapped run
 * @returns {string}
 */
const encodeWrappedBase64Like = (text, run) => {
  const encoded = encodeBase64Like(text, foldWhitespace(run));
  const { width, separator, indent } = wrappedLayout(run);
  const lines = [];
  for (let offset = 0; offset < encoded.length; offset += width) {
    lines.push(encoded.slice(offset, offset + width));
  }
  return lines.join(`${separator}${indent}`);
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
// is decoded, for conditions a regular expression cannot express. `findRuns`
// replaces `pattern` for shapes no single expression can locate efficiently.
const DECODERS = Object.freeze([
  // Wrapped base64 is tried before the single-line form so that its (wider)
  // range wins the overlap merge in `sanitizeEncodedCredentials`.
  { encoding: 'base64-wrapped', findRuns: findWrappedBase64Runs, decode: decodeWrappedBase64, encode: encodeWrappedBase64Like, accept: isWrappedBase64Candidate },
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
  const wrappedNeedles = [];
  for (const entry of knownTokens) {
    const value = typeof entry === 'string' ? entry : entry?.value;
    if (typeof value !== 'string' || value.length < 12) continue;

    for (const { encoding, needle } of encodedRepresentations(value)) {
      // A wrapped blob has line breaks inside it, so no needle occurs verbatim.
      // Collect the base64 forms for the folded scan below; the other encodings
      // are not line-wrapped by any tool we have seen.
      if (encoding === 'base64' || encoding === 'base64url') wrappedNeedles.push({ needle, value });

      let index = content.indexOf(needle);
      while (index !== -1) {
        const characterClass = CHARACTER_CLASS_FOR_ENCODING[encoding] || BASE64_CHARACTER;
        const range = expandRun(content, index, index + needle.length, characterClass);
        found.push({ ...range, encoding, value });
        index = content.indexOf(needle, index + needle.length);
      }
    }
  }

  if (wrappedNeedles.length > 0) {
    for (const { run, index } of findWrappedBase64Runs(content)) {
      if (!isWrappedBase64Candidate(run)) continue;
      const folded = foldWhitespace(run);
      for (const { needle, value } of wrappedNeedles) {
        if (!folded.includes(needle)) continue;
        found.push({ start: index, end: index + run.length, encoding: 'base64-wrapped', value });
        break;
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

  for (const decoder of DECODERS) {
    const { encoding, decode, accept } = decoder;
    for (const { run, index } of runsOf(decoder, content)) {
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

/**
 * Every run in `text` that decodes to printable text, with its decoded payload.
 *
 * This is the single walk over the decoder table that both the synchronous
 * masking path and the asynchronous scanner layer consume. Sharing it is the
 * point: an encoding one layer knows how to decode but the other does not would
 * be a hole exactly the width of the difference, and that hole would not show
 * up in any test that exercises only one of them.
 *
 * @param {string} input
 * @returns {Array<{start: number, end: number, encoding: string, run: string, decoded: string}>}
 *   in decoder-table order, so wrapped base64 precedes its single-line form
 */
export const findDecodableRuns = input => {
  const text = String(input ?? '');
  if (text.length === 0) return [];

  const found = [];
  for (const decoder of DECODERS) {
    const { encoding, decode, accept } = decoder;
    for (const { run, index } of runsOf(decoder, text)) {
      if (run.length < MIN_ENCODED_RUN_LENGTH) continue;
      if (accept && !accept(run)) continue;

      const decoded = decode(run);
      // Text rules over binary noise report credentials that are not there.
      // A genuinely encoded credential always decodes to printable text.
      if (typeof decoded !== 'string' || decoded.length === 0) continue;
      if (printableRatio(decoded) < MIN_PRINTABLE_RATIO) continue;

      found.push({ start: index, end: index + run.length, encoding, run, decoded });
    }
  }
  return found;
};

/** Look up a decoder by the `encoding` tag {@link findDecodableRuns} reports. */
const decoderFor = encoding => DECODERS.find(decoder => decoder.encoding === encoding);

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

  for (const { start, end, encoding, run, decoded } of findDecodableRuns(text)) {
    const sanitized = sanitizePlaintext(decoded);
    if (sanitized === decoded) continue;

    const { decode, encode } = decoderFor(encoding);
    let replacement = redactedMarker;
    const reEncoded = encode(sanitized, run);
    // Only substitute a rebuilt run when it provably decodes back to exactly
    // what we intended to publish.
    if (decode(reEncoded) === sanitized) replacement = reEncoded;

    replacements.push({ start, end, replacement });
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
  findWrappedBase64Runs,
  wrappedBase64HoldStart,
  encodedRepresentations,
  findEncodedKnownTokenRuns,
  findEncodedSecretRuns,
  findEncodedCredentialResiduals,
  sanitizeEncodedCredentials,
  printableRatio,
};
