/**
 * Hive Mind credential policy over @link-foundation/sensitive-data-sanitizer.
 *
 * Issues #3739 and #3740: Hive Mind no longer has its own credential rules.
 * Detection (vendor formats, Gitleaks rules, contextual keys, headers, URL
 * userinfo, PEM, cookies, query strings, known local values, encoded payloads)
 * and rendering (`hive-mask`, in-place re-encoding of base64/hex/percent
 * payloads) are done by the library. This module only supplies the Hive Mind
 * *policy* on top of it, through the library's own extension points:
 *
 *   1. Gap detectors (`detectors` option) for credential shapes the library does
 *      not detect yet.
 *   2. Exemptions: findings Hive Mind deliberately keeps (issue references
 *      below), removed before rendering.
 *   3. Visible parts: format context Hive Mind keeps readable around a
 *      credential (the Authorization scheme of issue #3739, a URL user name, PEM
 *      markers, cookie names, webhook endpoints). They are cut out of findings
 *      before rendering, so only the credential itself is masked.
 *
 * Every workaround names the upstream issue that asks for it to move into the
 * library (UPSTREAM below). When one is fixed upstream, delete the workaround and
 * the matching row in tests/issue-3739-sensitive-data-sanitizer-migration.test.mjs
 * keeps proving the behavior.
 *
 * Only credentials are in scope (`credentialsOnly: true`): e-mail addresses,
 * account IDs and logins are kept (issue #3724, rule 14).
 *
 * Tracing: set HIVE_MIND_SANITIZER_DEBUG=1 to print value-free decisions
 * (rule ids, offsets and lengths, never matched text) to stderr. Off by default.
 */

import { createRequire } from 'node:module';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findDecodableRuns, findEncodedKnownTokenRuns, sanitizeEncodedCredentials } from './encoded-credential-detection.lib.mjs';

export const SENSITIVE_DATA_SANITIZER_PACKAGE = '@link-foundation/sensitive-data-sanitizer';

/**
 * Upstream issues for every behavior this module works around. Referenced from
 * code comments, docs and tests; see docs/case-studies/issue-3739.
 */
export const UPSTREAM = Object.freeze({
  authorizationScheme: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-authorization-scheme',
  digestAuthorization: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-digest',
  idempotency: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-idempotency',
  exemptionHook: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-exemption-hook',
  configurationFlags: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-config-flags',
  formatContext: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-format-context',
  missedShapes: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-missed-shapes',
  syncLoading: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-sync-loading',
  wrappedEncoding: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-wrapped-encoding',
  candidateLimit: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-candidate-limit',
  pemSpan: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-pem-span',
  shortEncodedMask: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-short-encoded-mask',
  lineContextSpan: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-line-context-span',
  encodedLimitLines: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-encoded-limit-lines',
  shortHexKnownSecret: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/TBD-short-hex-known-secret',
});

const DEBUG = /^(?:1|true|yes)$/i.test(process.env.HIVE_MIND_SANITIZER_DEBUG || '');
const trace = (event, details) => {
  if (!DEBUG) return;
  try {
    process.stderr.write(`[hive-mind sanitizer] ${event} ${JSON.stringify(details)}\n`);
  } catch {
    // Tracing must never affect sanitization.
  }
};

// ---------------------------------------------------------------------------
// Library loading
// ---------------------------------------------------------------------------
// The library is ESM-only and exports only the `import` condition. The log()
// path is synchronous and is imported by every Hive Mind command, while the
// library takes about a second to load (it also loads its personal-data
// modules, which credentials-only callers never use). It is therefore loaded on
// the first sanitization, synchronously through Node's require(esm) support
// (Node.js >= 22.12; Hive Mind requires >= 24). Resolution goes through
// import.meta.resolve so the package's `exports` map is still honored.
// Upstream: UPSTREAM.syncLoading.
let library;
export const loadSensitiveDataSanitizer = () => {
  if (!library) {
    const require = createRequire(import.meta.url);
    library = require(fileURLToPath(import.meta.resolve(SENSITIVE_DATA_SANITIZER_PACKAGE)));
  }
  return library;
};

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Placeholders produced by `hive-mask`: never a credential, never re-masked. */
const MASK_PLACEHOLDER = /…|\[REDACTED\]/u;
// A run of asterisks is the mask of other tools (GitHub Actions' `***`,
// Hive Mind's docker argv masking): already masked, nothing left to protect.
const MASKED_VALUE = /^(?:\[REDACTED\]|[^\s]{0,3}…[^\s]{0,3}|\*{3,})$/u;

// Bounded affixes keep these expressions linear on long identifier-shaped runs
// (a 64 KB base64 blob took 19 s per rule with unbounded affixes).
const MAX_KEY_AFFIX = 64;
const SENSITIVE_KEY = String.raw`(?:[A-Za-z0-9_.-]{0,${MAX_KEY_AFFIX}}(?:api[-_]?key|account[-_]?key|client[-_]?secret|consumer[-_]?secret|webhook[-_]?secret|access[-_]?token|refresh[-_]?token|auth[-_]?token|password|passwd|pwd|private[-_]?key|secret|token|session[-_]?key|session[-_]?token|cookie|docker[-_]?auth|registry[-_]?auth|shared[-_]?access[-_]?signature|sas[-_]?token)[A-Za-z0-9_.-]{0,${MAX_KEY_AFFIX}}|auth|authorization)`;
// A delimiter is a quote optionally preceded by backslashes, so escaped JSON
// inside a JSON string (`{\"token\":\"...\"}`) is read like plain JSON.
const QUOTE = String.raw`\\*["']`;

// ---------------------------------------------------------------------------
// 1. Gap detectors (library `detectors` extension point)
// ---------------------------------------------------------------------------
// Each one covers a credential shape the library does not detect yet
// (UPSTREAM.missedShapes). Detectors also run on the library's decoded views and
// sanitized output, so a value that is already a mask placeholder is skipped;
// otherwise the library would see a never-ending residual.

const finding = (start, end, rule) => ({ start, end, category: 'credential', type: 'SECRET', rule });

const valueFinding = (match, value, rule) => {
  if (!value || MASK_PLACEHOLDER.test(value)) return null;
  const start = match.index + match[0].lastIndexOf(value);
  return finding(start, start + value.length, rule);
};

const regexDetector = (id, pattern, pick) => ({
  id,
  detect(text) {
    const findings = [];
    pattern.lastIndex = 0;
    for (const match of String(text).matchAll(pattern)) {
      const result = pick(match);
      if (result) findings.push(result);
    }
    return findings;
  },
});

// Opaque test/CI credentials carrying only an all-caps marker
// (`SYNTHETIC_TOKEN_ALPHA_123456`). The library finds one only when Gitleaks'
// generic rule happens to see an assignment in front of it. A digit is required:
// an all-caps run without one is a constant name (`KNOWN_LOCAL_TOKEN_ENV_VARS`,
// issue #3445).
const CAPS_MARKER = /\b(?=[A-Z_-]*[0-9])(?:[A-Z0-9]+[_-])+(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY)(?:[_-][A-Z0-9]+)+\b/g;

// `<clientSecret attr="1">value</clientSecret>`: XML elements with attributes.
const XML_ELEMENT = new RegExp(`<(${SENSITIVE_KEY})\\b[^<>]*>([^<]{1,4096})</\\1\\s*>`, 'gi');

// Ruby/Perl/PHP hash rockets: `{ 'password' => 'hunter2' }`, `secret=>LH5qO6yo`.
const HASH_ROCKET = new RegExp(`(?:${QUOTE})?(?<![A-Za-z0-9_.-])${SENSITIVE_KEY}(?:${QUOTE})?\\s*=>[ \\t]*(?:(${QUOTE})([^"'\\r\\n]+?)\\1|(?!${QUOTE}|[{[])([^\\s,;}&'"\\r\\n]+))`, 'gi');

// `token: <script>alert(1)</script>`: a value that begins with `<`. A bare
// `<placeholder>` is documentation and stays (see exemptions).
const ANGLE_VALUE = new RegExp(`(?<![A-Za-z0-9_.-])${SENSITIVE_KEY}(?:${QUOTE})?[ \\t]*[:=](?!>)[ \\t]*(<[^\\s,;}&'"]+)`, 'gi');

// Plural credential flags (`--access-tokens VALUE`). Token *accounting* flags
// (`--max-tokens 4096`, `--tokens-budget-stats`) are exempt (issue #3445).
const PLURAL_CREDENTIAL_FLAG = /--(?:[a-z0-9]+[-_.])*?(?:access|refresh|auth|session|sas|api)[-_.]?(?:tokens|keys|secrets)(?:\s+|=)(?!["'-])([^\s"'\r\n]+)/gi;

export const HIVE_GAP_DETECTORS = Object.freeze([regexDetector('hive-caps-marker', CAPS_MARKER, match => (MASK_PLACEHOLDER.test(match[0]) ? null : finding(match.index, match.index + match[0].length, 'hive-caps-marker'))), regexDetector('hive-xml-element', XML_ELEMENT, match => valueFinding(match, match[2].trim(), 'hive-xml-element')), regexDetector('hive-hash-rocket', HASH_ROCKET, match => valueFinding(match, match[2] ?? match[3], 'hive-hash-rocket')), regexDetector('hive-angle-value', ANGLE_VALUE, match => valueFinding(match, match[1], 'hive-angle-value')), regexDetector('hive-plural-flag', PLURAL_CREDENTIAL_FLAG, match => valueFinding(match, match[1], 'hive-plural-flag'))]);

// ---------------------------------------------------------------------------
// 2. Exemptions
// ---------------------------------------------------------------------------
// The library has no hook to keep a finding: a transformation callback that
// returns the original value fails with ERR_RESIDUAL (UPSTREAM.exemptionHook).
// Findings are therefore inspected, filtered here, and handed to `redact()`.

// Issue #2119: token *accounting* is not a credential (`"tokens": 1234`,
// `token_count=5`), but `access_token=123456` still is.
const TOKEN_COUNTER_KEY = /(?:tokens|token(?:count|limit|usage|budget|used|size|s?remaining)|(?:count|limit|usage|budget|used|size)tokens?)$/;
const NUMERIC_VALUE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;

// Issue #2156: npm package names contain `secret`/`token`/`auth`
// (`secretlint`, `next-auth`); their values are version ranges, never credentials.
const VERSION_COMPARATOR = String.raw`(?:\^|~|[><]=?|=)?\s*v?\d+(?:\.\d+){1,2}(?:[-+][0-9A-Za-z.-]+)?`;
const VERSION_RANGE_VALUE = new RegExp(`^${VERSION_COMPARATOR}(?:(?:\\s*(?:\\|\\||-)\\s*|\\s+)${VERSION_COMPARATOR})*$`);

// Issues #2400 and #3445: in source code and release notes a sensitive-named
// variable is assigned an expression, a literal or a documented placeholder,
// not a credential (`fileTokens = await …`, `…Tokens: false`, `token => …`,
// `password=<secret>`).
const KEYWORD_VALUE = /^(?:true|false|null|undefined|none|nil|await|async|new|typeof|function|this|void|yield|on|off|yes|no|enabled|disabled|…|\.\.\.|<[A-Za-z][\w .-]*>)$/i;

// Configuration switches whose name merely contains `auth`
// (`HIVE_MIND_ROUTER_AUTH_GUARD=0`, `GIT_AUTH_TRANSPORT=1`, `AUTH_MODE=2`) hold
// flags, not credentials. A credential noun in the name keeps the value masked
// (`AUTH_TOKEN=123456`). Upstream: UPSTREAM.configurationFlags.
const CREDENTIAL_NOUN = /token|secret|passw|pwd|key|cookie|credential|signature|sas|session|bearer/i;

// Markdown closes a code span or link right after a value; the library includes
// that punctuation in the value (`` `X_AUTH=1` `` gives "1`").
const TRAILING_CLOSING_PUNCTUATION = /[`)\]]+[.,:;!?]*$/;

const KEY_BEFORE_VALUE = /(?:^|[^A-Za-z0-9_.-])([A-Za-z0-9_.-]{1,160})\\*["']?\s*(?:=>|[:=])\s*\\*["']?$/;

const assignmentKey = (text, start) => {
  const lineStart = Math.max(text.lastIndexOf('\n', start - 1) + 1, start - 256);
  return KEY_BEFORE_VALUE.exec(text.slice(lineStart, start))?.[1] ?? null;
};

const normalizeKey = key =>
  String(key ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

const isPlaceholderValue = value => MASKED_VALUE.test(value) || (MASK_PLACEHOLDER.test(value) && value.replace(/\[REDACTED\]|[^\s…]{0,3}…[^\s…]{0,3}/gu, '').trim().length === 0);

// Issue #2397: the library re-flags a payload it re-encoded itself (base64 of
// `{"access_token":"gho…aEu"}`), so a second pass would replace the readable
// re-encoding with `[REDACTED]` and the publication boundary would treat that as
// a residual. A run whose decoded text is already clean under this policy is
// kept. Upstream: UPSTREAM.idempotency.
const MAX_ENCODED_DEPTH = 3;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
const decodeStrict = (value, encoding) => {
  try {
    const bytes = Buffer.from(value, encoding);
    // Only an exact round trip counts: Buffer.from skips invalid characters.
    if (bytes.toString(encoding).replace(/=+$/, '') !== value.replace(/=+$/, '')) return null;
    return STRICT_UTF8.decode(bytes);
  } catch {
    return null;
  }
};
const JSON_ESCAPE = /\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(["\\/'bfnrt]))/g;
const SIMPLE_ESCAPES = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const unescapeBackslashes = text => text.replace(JSON_ESCAPE, (_m, unicode, hex, simple) => (unicode || hex ? String.fromCharCode(parseInt(unicode || hex, 16)) : (SIMPLE_ESCAPES[simple] ?? simple)));
const HTML_ENTITY = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(quot|amp|lt|gt|apos));/g;
const NAMED_ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
const decodeEntities = text =>
  text.replace(HTML_ENTITY, (entity, decimal, hex, name) => {
    if (name) return NAMED_ENTITIES[name];
    const codePoint = parseInt(decimal ?? hex, decimal ? 10 : 16);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });

/**
 * The decoded views of a value that Hive Mind can reproduce: a covering
 * base64/hex/percent run, backslash escapes, HTML entities, or the whole value
 * strictly decoded. The library reports an `encoded` finding without its
 * decoded text (upstream: UPSTREAM.idempotency), so this is how the policy
 * learns whether an encoded run carries anything it would mask.
 */
const decodedViews = value => {
  const views = [];
  for (const run of findDecodableRuns(value)) if (run.start <= 0 && run.end >= value.length) views.push(run.decoded);
  if (value.includes('\\')) views.push(unescapeBackslashes(value));
  if (value.includes('&')) views.push(decodeEntities(value));
  if (/^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) views.push(decodeStrict(value.toLowerCase(), 'hex'));
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) views.push(decodeStrict(value, 'base64'));
  // A wrapped (folded) base64 run read as one value.
  else if (/^[A-Za-z0-9+/=\s]+$/.test(value) && /\n/.test(value)) views.push(decodeStrict(value.replace(/\s+/g, ''), 'base64'));
  if (/^[A-Za-z0-9_-]+={0,2}$/.test(value)) views.push(decodeStrict(value, 'base64url'));
  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      views.push(decodeURIComponent(value));
    } catch {
      // not percent-encoded text
    }
  }
  return [...new Set(views.filter(view => typeof view === 'string' && view !== value))];
};

// Issue #2156: an `encoded` finding over a run whose every reproducible decoded
// view is clean under the policy (typically a run the previous pass already
// re-encoded with masks inside) is not masked again.
const isCleanEncodedRun = (text, f, options, depth) => {
  if (depth >= MAX_ENCODED_DEPTH) return false;
  const views = decodedViews(text.slice(f.start, f.end));
  return views.length > 0 && views.every(view => findPolicyFindings(view, options, depth + 1).length === 0);
};

// With `preserveEncoding` a masked value is re-encoded in place
// (`Z2hv4oCmOTk5` is `gho…999`), and a context rule such as `"token":"…"`
// flags the re-encoded mask on the next pass. It is the mask, not a
// credential: it decodes to text that carries a placeholder and nothing the
// policy would flag.
const isEncodedMask = (value, options, depth) => {
  if (depth >= MAX_ENCODED_DEPTH || !value) return false;
  return decodedViews(value).some(view => MASK_PLACEHOLDER.test(view) && findPolicyFindings(view, options, depth + 1).length === 0);
};

/**
 * Return a reason when a finding is one Hive Mind deliberately keeps, or null.
 * Only value-free reasons are returned (they are traced).
 */
const exemptionReason = (text, f, options, depth) => {
  if (f.type === 'ENCODED_SENSITIVE') return isCleanEncodedRun(text, f, options, depth) ? 'clean-encoded-run' : null;
  const raw = text.slice(f.start, f.end);
  const value = raw.trim().replace(/^\\*["']|\\*["']$/g, '');
  // Issue #2397: an already-masked value is not re-masked (fixed point).
  // Upstream: UPSTREAM.idempotency.
  if (isPlaceholderValue(value)) return 'masked-placeholder';
  // A re-encoded mask is not re-masked either. Upstream: UPSTREAM.idempotency.
  if (isEncodedMask(value, options, depth)) return 'masked-encoded-placeholder';
  if (f.rule === 'known-secret') return null;
  const bare = value.replace(TRAILING_CLOSING_PUNCTUATION, '');
  if (KEYWORD_VALUE.test(value) || KEYWORD_VALUE.test(bare)) return 'keyword';
  if (VERSION_RANGE_VALUE.test(value)) return 'version-range';
  if (NUMERIC_VALUE.test(bare) || /^[01]$/.test(bare)) {
    const key = assignmentKey(text, f.start);
    if (key !== null) {
      const normalized = normalizeKey(key);
      if (TOKEN_COUNTER_KEY.test(normalized)) return 'token-counter';
      if (/auth/i.test(key) && !CREDENTIAL_NOUN.test(key)) return 'configuration-flag';
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// 3. Visible parts
// ---------------------------------------------------------------------------
// Ranges that stay readable even when the library's finding covers them
// (UPSTREAM.formatContext). Findings are split around them.

// Issue #3739: `Authorization: token <value>` must keep the scheme and mask the
// value. The library deliberately redacts "the scheme and one token"
// (UPSTREAM.authorizationScheme). Any scheme word is kept (`token`, `Bearer`,
// `Basic`, `ApiKey`, `AWS4-HMAC-SHA256`, ...), but only when another token
// follows it, so a lone credential is never mistaken for a scheme. The first
// segment must be letters only, which a random credential almost never is.
// A Digest-style quoted parameter name right after the scheme (`username="`)
// stays too; the library's span ends there (UPSTREAM.digestAuthorization).
const AUTHORIZATION_SCHEME = /\b(?:Proxy-)?Authorization\\*["']?\s*[:=]\s*\\*["']?([A-Za-z]{2,32}(?:[-_][A-Za-z0-9]{1,16}){0,3})[ \t]+(?=[^\s"'\\,;])([A-Za-z][\w-]{0,31}=(?="))?/dgi;
// URL userinfo: the user name stays, the password is masked.
const URL_USER = /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:(?=[^@\s/]+@)/gi;
// PEM: markers and line breaks stay; key material is masked.
const PEM_MARKERS = /-----(?:BEGIN|END) [A-Z0-9 ]*PRIVATE KEY-----\s*|\s*(?=-----END [A-Z0-9 ]*PRIVATE KEY-----)/g;
// Cookie headers: each cookie name stays; each value is masked separately.
const COOKIE_HEADER = /\b(?:Set-)?Cookie\s*:[ \t]*([^\r\n]*)/gi;
const COOKIE_NAME = /(^|;\s*)([^=;\s]+=)/g;
// Webhook endpoints: the service URL stays; the path credential is masked.
const WEBHOOK_PREFIX = /https:\/\/(?:hooks\.slack\.com\/services\/|(?:canary\.)?discord(?:app)?\.com\/api\/webhooks\/)/gi;

const visibleRanges = text => {
  const ranges = [];
  const add = (start, end) => {
    if (end > start) ranges.push([start, end]);
  };
  for (const match of text.matchAll(AUTHORIZATION_SCHEME)) add(match.indices[1][0], match.index + match[0].length);
  for (const match of text.matchAll(URL_USER)) add(match.index, match.index + match[0].length);
  for (const match of text.matchAll(PEM_MARKERS)) add(match.index, match.index + match[0].length);
  for (const header of text.matchAll(COOKIE_HEADER)) {
    const valueStart = header.index + header[0].length - header[1].length;
    for (const pair of header[1].matchAll(COOKIE_NAME)) add(valueStart + pair.index, valueStart + pair.index + pair[0].length);
  }
  for (const match of text.matchAll(WEBHOOK_PREFIX)) add(match.index, match.index + match[0].length);
  return ranges.sort((a, b) => a[0] - b[0]);
};

const subtractRanges = (f, ranges) => {
  let pieces = [{ ...f }];
  for (const [start, end] of ranges) {
    if (end <= f.start || start >= f.end) continue;
    pieces = pieces.flatMap(piece => {
      if (end <= piece.start || start >= piece.end) return [piece];
      const out = [];
      if (start > piece.start) out.push({ ...piece, end: start });
      if (end < piece.end) out.push({ ...piece, start: end });
      return out;
    });
  }
  return pieces;
};

const trimPiece = (text, piece) => {
  let { start, end } = piece;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  // A value ending in a Markdown backtick that it never opened.
  const value = text.slice(start, end);
  const trailing = /`+$/.exec(value);
  if (trailing && !value.slice(0, -trailing[0].length).includes('`')) end -= trailing[0].length;
  // A cookie piece ends at the `;` separator.
  if (piece.cookie) end = start + text.slice(start, end).replace(/[;\s]+$/, '').length;
  // Sentence punctuation after a value (`token ghp_….`, `key: abc…xyz, then`)
  // ends the sentence, not the credential. Upstream: UPSTREAM.lineContextSpan.
  if (end === text.length || /\s/.test(text[end])) {
    const punctuation = /[.,;!?]+$/.exec(text.slice(start, end));
    if (punctuation && end - start - punctuation[0].length >= 8) end -= punctuation[0].length;
  }
  return { ...piece, start, end };
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const BASE_OPTIONS = Object.freeze({
  credentialsOnly: true,
  // Issue #2156: decoded payloads are sanitized and re-encoded in place, so a
  // base64 JSON document stays decodable with only the credential masked.
  preserveEncoding: true,
  detectors: HIVE_GAP_DETECTORS,
});

const RENDER_OPTIONS = Object.freeze({
  ...BASE_OPTIONS,
  // first three + `…` + last three code points, `[REDACTED]` up to twelve.
  transformation: Object.freeze({ mode: 'hive-mask' }),
  // Private keys are never partially shown.
  transformations: Object.freeze({ PRIVATE_KEY: Object.freeze({ mode: 'redact' }) }),
});

const MAX_CACHED_SANITIZERS = 16;
const sanitizers = new Map();

const knownSecretList = knownSecrets => [...new Set((knownSecrets || []).map(token => (typeof token === 'string' ? token : token?.value)).filter(value => typeof value === 'string' && value.length > 0 && !MASK_PLACEHOLDER.test(value)))].sort();

const getSanitizer = (secrets, knownOnly = false) => {
  const key = `${knownOnly ? 'known' : 'all'}\u0000${secrets.join('\u0000')}`;
  let entry = sanitizers.get(key);
  if (!entry) {
    const { createSyncSanitizer } = loadSensitiveDataSanitizer();
    const detectOptions = { ...BASE_OPTIONS, knownSecrets: secrets, knownOnly };
    entry = { detector: createSyncSanitizer(detectOptions), renderOptions: { ...RENDER_OPTIONS, knownSecrets: secrets, knownOnly } };
    if (sanitizers.size >= MAX_CACHED_SANITIZERS) sanitizers.delete(sanitizers.keys().next().value);
    sanitizers.set(key, entry);
  }
  return entry;
};

const isPem = (text, f) => f.rule === 'private-key' || /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text.slice(f.start, f.end));

// A private-key rule that needs a long body (gitleaks: 64+ characters) does
// not end a short or already-masked block at its own END marker; it runs on to
// the END of the next block and takes every line between the two blocks with
// it. A PEM finding ends at the first END marker after its BEGIN.
// Upstream: UPSTREAM.pemSpan.
const PEM_END = /-----END [A-Z0-9 ]*-----/g;
const clipPem = (text, f) => {
  PEM_END.lastIndex = f.start;
  const end = PEM_END.exec(text);
  return end && end.index < f.end && end.index + end[0].length < f.end ? { ...f, end: end.index + end[0].length } : f;
};

// A `key: value` context value runs to the end of the line, so a passphrase
// with spaces is masked whole. When the value is a complete vendor-format
// credential (`Token: ghp_…, then …`), the line goes on with prose that the
// library masks with it. A context finding that starts exactly where a
// format finding starts, and continues past it only after a delimiter, ends
// with that credential. Upstream: UPSTREAM.lineContextSpan.
// A value that already starts with a Hive mask (the same line on the next
// fixed-point pass) ends there too, so sanitizing stays idempotent.
const LEADING_MASK = /^(?:\[REDACTED\]|[^\s…]{0,3}…[^\s…]{0,3})/u;
const clipContextToFormat = (text, f, raw) => {
  if (f.rule !== 'context') return f;
  const endsValue = end => end > f.start && end < f.end && /^[.,;:!?)\]]*\s/u.test(text.slice(end, f.end));
  // The shortest complete credential: a truncated format match (gitleaks'
  // 40-character github-pat) is not followed by a delimiter.
  const inner = raw.filter(other => other.category === 'credential' && other.rule !== 'context' && other.rule !== 'cookie' && other.start === f.start && endsValue(other.end)).sort((a, b) => a.end - b.end)[0];
  const end = inner ? inner.end : f.start + (LEADING_MASK.exec(text.slice(f.start, f.end))?.[0].length ?? 0);
  if (!endsValue(end)) return f;
  trace('clip-context', { rule: inner?.rule ?? 'mask', start: f.start, length: f.end - f.start, kept: end - f.start });
  return { ...f, end };
};

/**
 * Inspect `text` and return the findings Hive Mind masks, after exemptions and
 * with visible parts cut out. Findings carry offsets and rule ids only.
 */
export const findCredentialFindings = (text, options = {}) => findPolicyFindings(String(text ?? ''), options, 0);

// The library refuses (ERR_LIMIT) a text with more than 4096 decodable
// candidates in one call: a 1 MB base64 dump on a terminal, or a long log full
// of 16+ character identifiers, would block output although it holds no
// credential. Such a text is inspected in pieces cut at line breaks (spaces when
// a line has none) that never fall inside a PEM block, so every multi-line
// construct the library recognizes stays whole; wrapped base64 runs were
// already handled across the whole text by sanitizeWrappedRuns.
// Upstream: UPSTREAM.candidateLimit.
const MIN_SPLITTABLE_LENGTH = 256;
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g;
const splitPoint = text => {
  const middle = text.length >> 1;
  const blocks = [...text.matchAll(PEM_BLOCK)].map(match => [match.index, match.index + match[0].length]);
  for (const separator of ['\n', ' ', '\t']) {
    for (const from of [text.lastIndexOf(separator, middle), text.indexOf(separator, middle)]) {
      if (from <= 0) continue;
      let at = from + 1;
      const block = blocks.find(([start, end]) => at > start && at < end);
      if (block) at = block[1] < text.length ? block[1] : block[0];
      if (at > 0 && at < text.length) return at;
    }
  }
  return -1;
};
const inspectWithinLimits = (detector, text, offset = 0) => {
  try {
    const findings = detector.inspect(text);
    return offset === 0 ? findings : findings.map(f => ({ ...f, start: f.start + offset, end: f.end + offset }));
  } catch (error) {
    if (error?.code !== 'ERR_LIMIT' || text.length < MIN_SPLITTABLE_LENGTH) throw error;
    const at = splitPoint(text);
    if (at < 0) throw error;
    trace('split', { reason: 'ERR_LIMIT', length: text.length, at });
    return [...inspectWithinLimits(detector, text.slice(0, at), offset), ...inspectWithinLimits(detector, text.slice(at), offset + at)];
  }
};

// A run of 16+ character base64-alphabet lines longer than 8192 characters
// gets one `encoded-limit` finding over the whole run, because the library
// does not decode runs that long. A list of commit SHAs or generated ids is
// such a run, so a `git rev-list` of 250 commits was masked completely. Hive
// Mind's wrapped layer (sanitizeWrappedRuns) has already decoded and sanitized
// every genuine wrapped payload up to its 256 KiB bound across the whole text,
// so within that bound the run is inspected again in line-aligned pieces the
// library can decode (each line is still decoded on its own). Longer runs keep
// the fail-closed limit finding. Upstream: UPSTREAM.encodedLimitLines.
const MAX_LIMITED_RUN_PIECE = 4096;
const MAX_REINSPECTED_LIMITED_RUN = 256 * 1024;
const reinspectLimitedRun = (detector, input, f) => {
  if (f.rule !== 'encoded-limit' || f.end - f.start > MAX_REINSPECTED_LIMITED_RUN || input.lastIndexOf('\n', f.end - 1) < f.start) return [f];
  const findings = [];
  for (let start = f.start; start < f.end;) {
    let end = Math.min(f.end, start + MAX_LIMITED_RUN_PIECE);
    if (end < f.end) {
      const lineEnd = input.lastIndexOf('\n', end - 1);
      if (lineEnd <= start) return [f];
      end = lineEnd + 1;
    }
    findings.push(...inspectWithinLimits(detector, input.slice(start, end), start));
    start = end;
  }
  trace('reinspect-limited-run', { start: f.start, length: f.end - f.start, findings: findings.length });
  return findings.some(finding => finding.rule === 'encoded-limit') ? [f] : findings;
};

// The library finds the hex form of a known secret only from 16 bytes on (its
// hex runs start at 32 digits), so the hex of a 12 to 15 character secret stayed
// raw. Hive Mind's exact encoded matcher (#2156, which skips values below 12
// characters, as before the migration) supplies those occurrences when the
// library has nothing there. Upstream: UPSTREAM.shortHexKnownSecret.
const MIN_LIBRARY_HEX_SECRET = 16;
const shortKnownSecretFindings = (input, secrets, raw) => {
  const short = secrets.filter(value => value.length < MIN_LIBRARY_HEX_SECRET);
  if (short.length === 0) return [];
  const findings = findEncodedKnownTokenRuns(input, short)
    .filter(run => !raw.some(f => f.start < run.end && run.start < f.end))
    .map(run => ({ ...finding(run.start, run.end, 'known-secret'), encoding: run.encoding }));
  if (findings.length > 0) trace('short-known-secret', { findings: findings.length, encodings: [...new Set(findings.map(f => f.encoding))] });
  return findings;
};

const findPolicyFindings = (input, { knownSecrets = [], knownOnly = false } = {}, depth = 0) => {
  if (!input) return [];
  const secrets = knownSecretList(knownSecrets);
  const { detector } = getSanitizer(secrets, knownOnly);
  const inspected = inspectWithinLimits(detector, input).flatMap(f => reinspectLimitedRun(detector, input, f));
  const raw = [...inspected, ...shortKnownSecretFindings(input, secrets, inspected)];
  if (raw.length === 0) return [];
  const ranges = visibleRanges(input);
  const result = [];
  for (const f of raw) {
    if (f.category !== 'credential') continue;
    const pem = isPem(input, f);
    const cookie = f.rule === 'cookie' || (f.rule === 'context' && raw.some(other => other.rule === 'cookie' && other.start === f.start));
    for (const piece of subtractRanges(pem ? clipPem(input, f) : clipContextToFormat(input, f, raw), ranges)) {
      const trimmed = trimPiece(input, { ...piece, cookie });
      if (trimmed.end <= trimmed.start) continue;
      const reason = exemptionReason(input, trimmed, { knownSecrets, knownOnly }, depth);
      if (reason) {
        trace('exempt', { rule: f.rule, reason, start: trimmed.start, length: trimmed.end - trimmed.start });
        continue;
      }
      result.push({ start: trimmed.start, end: trimmed.end, category: 'credential', type: pem ? 'PRIVATE_KEY' : f.type, rule: f.rule });
    }
  }
  trace('findings', { inspected: raw.length, masked: result.length, rules: [...new Set(result.map(f => f.rule))] });
  return result;
};

// Base64 wrapped across lines (`base64 -w 76`, PEM-style bodies) is decoded by
// the library one line at a time: the first line is rewritten and the other
// lines of the credential's encoding stay raw. Hive Mind's own encoded layer
// reassembles the wrapped run, sanitizes the decoded text with this policy and
// re-encodes it with the original wrapping. Upstream: UPSTREAM.wrappedEncoding.
const WRAPPED_ENCODINGS = Object.freeze(['base64-wrapped']);
const sanitizeWrappedRuns = (input, options, depth) => {
  if (depth >= MAX_ENCODED_DEPTH || input.indexOf('\n') === -1) return input;
  return sanitizeEncodedCredentials(input, {
    encodings: WRAPPED_ENCODINGS,
    knownTokens: options.knownSecrets ?? [],
    sanitizePlaintext: decoded => sanitizeWithPolicy(decoded, options, depth + 1),
  });
};

// The library re-encodes a masked encoded payload in its original encoding and
// verifies the result decodes back. A hex payload is only recognized from 16
// bytes on, so a masked value shorter than that (`Pla…nTr` is 9 bytes) fails the
// check and `redact()` throws ERR_ENCODING for the whole text: one short hex
// token blocks a complete log. Such a run is masked as it stands instead (the
// raw encoded text gets the usual mask); every other finding keeps the
// encoding-preserving rendering. Upstream: UPSTREAM.shortEncodedMask.
const renderFindings = (input, findings, renderOptions) => {
  const { redact } = loadSensitiveDataSanitizer();
  try {
    return redact(input, findings, renderOptions);
  } catch (error) {
    if (error?.code !== 'ERR_ENCODING') throw error;
  }
  const renderable = findings.map(finding => {
    if (finding.type !== 'ENCODED_SENSITIVE') return finding;
    const raw = input.slice(finding.start, finding.end);
    try {
      redact(raw, [{ ...finding, start: 0, end: raw.length }], renderOptions);
      return finding;
    } catch (error) {
      if (error?.code !== 'ERR_ENCODING') throw error;
      trace('encoding-fallback', { start: finding.start, length: raw.length });
      return { ...finding, type: 'SECRET' };
    }
  });
  return redact(input, renderable, renderOptions);
};

/**
 * One sanitization pass: Hive Mind's wrapped-base64 layer, library detection,
 * Hive Mind policy, library rendering.
 *
 * Options:
 * - `knownSecrets`: exact values masked wherever they appear, plain or encoded.
 * - `knownOnly`: mask only `knownSecrets` (and their encoded copies), no
 *   pattern detection; the `skipOutputSanitization` mode of sanitizeOutput.
 * - `onFindings`: `count => void`, the number of findings masked by this pass.
 */
export const sanitizeWithPolicy = (text, options = {}, depth = 0) => {
  const { knownSecrets = [], knownOnly = false } = options;
  if (knownOnly && knownSecrets.length === 0) return String(text ?? '');
  const input = sanitizeWrappedRuns(String(text ?? ''), options, depth);
  const findings = findPolicyFindings(input, { knownSecrets, knownOnly }, depth);
  if (findings.length === 0) return input;
  if (depth === 0 && typeof options.onFindings === 'function') options.onFindings(findings.length);
  const { renderOptions } = getSanitizer(knownSecretList(knownSecrets), knownOnly);
  return renderFindings(input, findings, renderOptions);
};
