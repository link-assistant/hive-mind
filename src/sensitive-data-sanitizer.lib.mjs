/**
 * Shared credentials-only engine for every Hive Mind publication surface.
 *
 * The library owns detection, exemptions, format context, encoded payloads and
 * residual verification (#3739, #3740). Load its small synchronous entry lazily
 * so CLI commands that never sanitize do not initialize a detector.
 * Set HIVE_MIND_SANITIZER_DEBUG=1 for value-free tracing (off by default).
 */
import { createRequire } from 'node:module';

export const SENSITIVE_DATA_SANITIZER_PACKAGE = '@link-foundation/sensitive-data-sanitizer';
// Remaining library gaps must link an upstream report here and have a focused
// regression test. Issues #131–#141 were fixed in 0.21.0, #148 in 0.21.2,
// #149 in 0.21.3, #153 in 0.21.4, #152 in 0.21.5, #151 in 0.21.6,
// #154 in 0.21.7, #150 in 0.21.8, #162 in 0.22.1, #168 in 0.22.2 and #170 in
// 0.22.3. #172 (long letter runs in two-byte text) still needs the fallback below;
// #173 is a documented performance limit; #177 needs the code-span exemption below.
export const UPSTREAM = Object.freeze({
  longLetterRunStackOverflow: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/172',
  // Performance only, output is unaffected: a credential keyword followed by one
  // long value (`password=` + 1 MiB) costs ~12 µs per character in the vendored
  // gitleaks generic-api-key rule, ~100x plain text. Linear and bounded by the log
  // size, so Hive Mind documents it instead of re-implementing that rule.
  longCredentialValueScan: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/173',
  authorizationCodeSpanPlaceholder: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/177',
});
const require = createRequire(import.meta.url);
let library;
export const loadSensitiveDataSanitizer = () => (library ??= require(`${SENSITIVE_DATA_SANITIZER_PACKAGE}/credentials`));

export const credentialEnvironmentValues = (env = process.env) => loadSensitiveDataSanitizer().knownSecretsFromEnv(env);

const DEBUG = /^(?:1|true|yes)$/i.test(process.env.HIVE_MIND_SANITIZER_DEBUG || '');
const trace = event => {
  if (!DEBUG) return;
  try {
    // Copy only explicitly value-free metadata, never arbitrary callback data.
    const safe = Object.fromEntries(Object.entries(event).filter(([key, value]) => ['event', 'rule', 'ruleId', 'inputLength', 'elapsedMs', 'round', 'findings', 'redactions'].includes(key) && ['string', 'number'].includes(typeof value)));
    process.stderr.write(`[hive-mind sanitizer] ${JSON.stringify(safe)}\n`);
  } catch {
    // Tracing must never affect sanitization.
  }
};

// Upstream #177 (0.22.3): an Authorization value does not end at a Markdown
// backtick, so in `Authorization: token <value>` the value read is `<value>``,
// the library's own placeholder exemption misses it and the backtick is eaten
// (the 2.40.1 release note, issue #4050). Keep only a value that is exactly one
// complete template followed by the closing backtick of a code span opened
// earlier on the same line. Known secrets are never offered to `exempt`.
const CODE_SPAN_PLACEHOLDER = /^(?:<[A-Za-z_][\w -]{0,63}>|\$[A-Za-z_]\w*|\$\{[A-Za-z_]\w*\})`$/;
const AUTHORIZATION_PREFIX = /(?:Proxy-)?Authorization[ \t]*:[ \t]*(?:[A-Za-z][\w-]*[ \t]+)?$/i;
export const isCodeSpanAuthorizationPlaceholder = (finding, text) => {
  if (finding.rule !== 'authorization' && finding.rule !== 'context') return false;
  if (!CODE_SPAN_PLACEHOLDER.test(text.slice(finding.start, finding.end))) return false;
  const before = text.slice(text.lastIndexOf('\n', finding.start - 1) + 1, finding.start);
  if (!AUTHORIZATION_PREFIX.test(before)) return false;
  let backticks = 0;
  for (const char of before) if (char === '`') backticks++;
  return backticks % 2 === 1;
};
const exempt = (finding, text) => {
  const kept = isCodeSpanAuthorizationPlaceholder(finding, text);
  if (kept) trace({ event: 'exempt:code-span-authorization-placeholder', rule: finding.rule });
  return kept;
};

const sanitizers = new Map();
const MAX_CACHED_SANITIZERS = 16;
const getSanitizer = ({ knownSecrets = [], knownOnly = false } = {}) => {
  const secrets = [...new Set(knownSecrets.map(token => (typeof token === 'string' ? token : token?.value)).filter(value => typeof value === 'string' && value.length > 0))].sort();
  // JSON encoding avoids collisions between token lists containing separators.
  const key = JSON.stringify([knownOnly, secrets]);
  let sanitizer = sanitizers.get(key);
  if (!sanitizer) {
    sanitizer = loadSensitiveDataSanitizer().createSyncSanitizer({
      credentialsOnly: true,
      knownSecrets: secrets,
      knownOnly,
      preserveEncoding: true,
      exempt,
      transformation: { mode: 'hive-mask' },
      transformations: { PRIVATE_KEY: { mode: 'redact' } },
      ...(DEBUG ? { debug: trace } : {}),
    });
    if (sanitizers.size >= MAX_CACHED_SANITIZERS) sanitizers.delete(sanitizers.keys().next().value);
    sanitizers.set(key, sanitizer);
  }
  return sanitizer;
};

// Upstream #172: on a two-byte string (any character above U+00FF) the
// library's credential-word regex overflows V8's regexp stack on a letter or
// digit run of about 4 MiB, so sanitize() and inspect() throw ERR_SANITIZATION
// for a whole log block (0.12.1–0.22.3). A run on its own is one-byte when it is
// Latin-1 and passes, so on that error we isolate each long run, process the
// text between runs with bounded windows of the neighbouring runs as context,
// and fail closed (rethrow) whenever a window or alignment pad would change.
const LONG_RUN_CHARS = 64 * 1024;
const RUN_WINDOW_CHARS = 4 * 1024;
const hasLongRun = text => /[\p{L}\p{N}]{65536}/u.test(text);
const isBase64Char = code => (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47 || code === 45 || code === 95;

const findLongRuns = text => {
  // A bounded quantifier keeps this scan itself off the irregexp stack limit.
  const runs = [];
  let current = null;
  for (const match of text.matchAll(/[\p{L}\p{N}]{1,4096}/gu)) {
    if (current && current.end === match.index) current.end += match[0].length;
    else runs.push((current = { start: match.index, end: match.index + match[0].length }));
  }
  return runs.filter(run => run.end - run.start >= LONG_RUN_CHARS);
};

// Keep base64 quantum alignment so decoded views of a split blob stay the same.
const base64Offset = (text, index) => {
  let start = index;
  while (start > 0 && isBase64Char(text.charCodeAt(start - 1))) start--;
  return (index - start) % 4;
};

/** Pieces of `text`, each with the context-only prefix/suffix that must come back unchanged. */
const splitAroundLongRuns = (text, runs) => {
  const pieces = [];
  for (let index = 0; index <= runs.length; index++) {
    const previous = runs[index - 1];
    const next = runs[index];
    const start = previous ? previous.end : 0;
    const end = next ? next.start : text.length;
    if (end > start) {
      let windowStart = start;
      if (previous) {
        const alignBase = previous.start - previous.pad;
        windowStart = previous.end - RUN_WINDOW_CHARS;
        windowStart -= (windowStart - alignBase) % 4;
      }
      const windowEnd = next ? Math.min(next.end, next.start + RUN_WINDOW_CHARS) : end;
      pieces.push({ offset: windowStart, prefix: start - windowStart, body: end - start, suffix: windowEnd - end });
    }
    if (next) {
      next.pad = base64Offset(text, next.start);
      pieces.push({ offset: next.start - next.pad, prefix: next.pad, body: next.end - next.start, suffix: 0 });
    }
  }
  return pieces;
};

const withLongRunFallback = (text, error, operation, fallback) => {
  if (error?.code !== 'ERR_SANITIZATION' || !hasLongRun(text)) throw error;
  const runs = findLongRuns(text);
  trace({ event: `${operation}:long-run-fallback`, inputLength: text.length, round: runs.length });
  try {
    return fallback(splitAroundLongRuns(text, runs));
  } catch {
    trace({ event: `${operation}:long-run-fallback-failed`, inputLength: text.length });
    throw error;
  }
};

const sanitizeAroundLongRuns = (sanitizer, text, pieces) => {
  let output = '';
  let redactions = 0;
  for (const piece of pieces) {
    const source = text.slice(piece.offset, piece.offset + piece.prefix + piece.body + piece.suffix);
    const result = sanitizer.sanitize(source);
    const prefix = source.slice(0, piece.prefix);
    const suffix = source.slice(source.length - piece.suffix);
    // Context changed: the windows hide part of a finding, so stay fail closed.
    if (result.text.length < prefix.length + suffix.length || !result.text.startsWith(prefix) || !result.text.endsWith(suffix)) throw new Error('long-run window changed');
    output += result.text.slice(prefix.length, result.text.length - suffix.length);
    redactions += result.redactions;
  }
  return { text: output, redactions };
};

const inspectAroundLongRuns = (sanitizer, text, pieces) => {
  const lineStarts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) lineStarts.push(index + 1);
  const lineOf = offset => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const seen = new Map();
  for (const piece of pieces) {
    for (const finding of sanitizer.inspect(text.slice(piece.offset, piece.offset + piece.prefix + piece.body + piece.suffix))) {
      const start = finding.start + piece.offset;
      const end = finding.end + piece.offset;
      const key = `${start}:${end}:${finding.rule}`;
      if (seen.has(key)) continue;
      const line = lineOf(start);
      seen.set(key, { ...finding, start, end, line: line + 1, column: start - lineStarts[line] + 1 });
    }
  }
  return [...seen.values()].sort((left, right) => left.start - right.start || left.end - right.end);
};

/** Value-free findings; offsets are UTF-16 code units. */
export const findCredentialFindings = (text, options = {}) => {
  const value = String(text ?? '');
  const sanitizer = getSanitizer(options);
  try {
    return sanitizer.inspect(value);
  } catch (error) {
    return withLongRunFallback(value, error, 'inspect', pieces => inspectAroundLongRuns(sanitizer, value, pieces));
  }
};

/** Includes the library's own residual verification, including decoded views. */
export const sanitizeWithPolicy = (text, options = {}) => {
  const value = String(text ?? '');
  const sanitizer = getSanitizer(options);
  let result;
  try {
    result = sanitizer.sanitize(value);
  } catch (error) {
    result = withLongRunFallback(value, error, 'sanitize', pieces => sanitizeAroundLongRuns(sanitizer, value, pieces));
  }
  if (result.redactions > 0 && typeof options.onFindings === 'function') options.onFindings(result.redactions);
  return result.text;
};
