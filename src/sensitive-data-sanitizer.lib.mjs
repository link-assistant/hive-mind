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
// 0.22.3, #172 (long letter runs in two-byte text) and #177 in 0.22.4, and
// #181 in 0.22.5, which retired the adapter's long-run fallback and its
// code-span `exempt` hook (#4050, #4055). #173 is a documented performance limit.
export const UPSTREAM = Object.freeze({
  // Performance only, output is unaffected: a credential keyword followed by one
  // long value (`password=` + 1 MiB) costs ~12 µs per character in the vendored
  // gitleaks generic-api-key rule, ~100x plain text. Linear and bounded by the log
  // size, so Hive Mind documents it instead of re-implementing that rule.
  longCredentialValueScan: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/173',
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
