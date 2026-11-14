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
// #154 in 0.21.7, #150 in 0.21.8, #162 in 0.22.1, #168 in 0.22.2, #170 in
// 0.22.3, and #172 (long letter runs in two-byte text) and #177 in 0.22.4.
// #173 is a documented performance limit; #181 needs the code-span exemption below.
export const UPSTREAM = Object.freeze({
  // Performance only, output is unaffected: a credential keyword followed by one
  // long value (`password=` + 1 MiB) costs ~12 µs per character in the vendored
  // gitleaks generic-api-key rule, ~100x plain text. Linear and bounded by the log
  // size, so Hive Mind documents it instead of re-implementing that rule.
  longCredentialValueScan: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/173',
  // Still open after the #177 fix in 0.22.4: a placeholder followed by a
  // literal backtick inside a double-backtick span (the 2.40.2 release note).
  doubleBacktickCodeSpanPlaceholder: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/181',
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

// Upstream #177 (fixed in 0.22.4) and #181 (open): an Authorization value does not end at a Markdown
// backtick, so in `Authorization: token <value>` the value read is `<value>``,
// the library's own placeholder exemption misses it and the backtick is eaten
// (the 2.40.1 release note, issue #4050). Keep only a value that is exactly one
// complete template followed by the closing backtick of a code span opened
// earlier on the same line, and only if the library itself keeps that value when
// no backtick follows it, so the exemption is never broader than upstream's own
// placeholder rule. Known secrets are never offered to `exempt`.
let parityChecker;
const libraryKeepsPlainValue = value => {
  parityChecker ??= loadSensitiveDataSanitizer().createSyncSanitizer({ credentialsOnly: true });
  const plain = `Authorization: token ${value}`;
  return parityChecker.sanitize(plain).text === plain;
};
// The template is optional: in `Authorization:` (the header named in prose, as
// in the 2.40.2 release note) the value read is the closing backtick alone.
const CODE_SPAN_PLACEHOLDER = /^(?:<[A-Za-z_][\w -]{0,63}>|\$[A-Za-z_]\w*|\$\{[A-Za-z_]\w*\})?`$/;
const AUTHORIZATION_PREFIX = /(?:Proxy-)?Authorization[ \t]*:[ \t]*(?:[A-Za-z][\w-]*[ \t]+)?$/i;
export const isCodeSpanAuthorizationPlaceholder = (finding, text) => {
  if (finding.rule !== 'authorization' && finding.rule !== 'context') return false;
  const value = text.slice(finding.start, finding.end);
  if (!CODE_SPAN_PLACEHOLDER.test(value)) return false;
  const before = text.slice(text.lastIndexOf('\n', finding.start - 1) + 1, finding.start);
  if (!AUTHORIZATION_PREFIX.test(before)) return false;
  let backticks = 0;
  for (const char of before) if (char === '`') backticks++;
  // A lone backtick holds no characters to compare, so there is nothing to probe.
  return backticks % 2 === 1 && (value === '`' || libraryKeepsPlainValue(value.slice(0, -1)));
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

/** Value-free findings; offsets are UTF-16 code units. */
export const findCredentialFindings = (text, options = {}) => {
  const value = String(text ?? '');
  return getSanitizer(options).inspect(value);
};

/** Includes the library's own residual verification, including decoded views. */
export const sanitizeWithPolicy = (text, options = {}) => {
  const value = String(text ?? '');
  const result = getSanitizer(options).sanitize(value);
  if (result.redactions > 0 && typeof options.onFindings === 'function') options.onFindings(result.redactions);
  return result.text;
};
