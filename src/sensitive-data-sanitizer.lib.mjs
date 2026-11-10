/**
 * Shared credentials-only engine for every Hive Mind publication surface.
 *
 * The library owns detection, exemptions, format context, encoded payloads and
 * residual verification (#3739, #3740). Load its small synchronous entry lazily
 * so CLI commands that never sanitize do not initialize a detector.
 * Set HIVE_MIND_SANITIZER_DEBUG=1 for value-free tracing (off by default).
 */
import { createRequire } from 'node:module';
import { findWrappedBase64Runs, sanitizeEncodedCredentials } from './encoded-credential-detection.lib.mjs';

export const SENSITIVE_DATA_SANITIZER_PACKAGE = '@link-foundation/sensitive-data-sanitizer';
// Remaining library gaps must link an upstream report here and have a focused
// regression test. Issues #131–#141 were fixed in library 0.21.0.
export const UPSTREAM = Object.freeze({
  maskedProse: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/148',
  wrappedPayload: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/149',
  constructorKeyword: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/150',
  markdownValues: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/151',
  overlappingScheme: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/152',
  encodedMask: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/153',
  privateKeyType: 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/154',
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
  let engine = sanitizers.get(key);
  if (!engine) {
    const state = { wrapped: false, text: null, ranges: [], exemptionDepth: 0 };
    engine = {
      state,
      sanitizer: loadSensitiveDataSanitizer().createSyncSanitizer({
        credentialsOnly: true,
        knownSecrets: secrets,
        knownOnly,
        preserveEncoding: true,
        // The library re-masks `ghp…xyz. Next sentence` on its second pass.
        // Only a complete mask at the start of a prose finding is exempted;
        // declared known secrets are never passed to this hook by the library.
        // Upstream: UPSTREAM.maskedProse.
        exempt: (finding, text) =>
          (finding.rule === 'context' && /^(?:[^\s…]{0,3}…[^\s…]{0,3}|\[REDACTED\])(?:[.,;:!?]+\s|\s)/u.test(text.slice(finding.start, finding.end))) ||
          // Upstream #150: retain `new` only in an actual constructor call.
          (finding.rule === 'context' && text.slice(finding.start, finding.end) === 'new' && /^new\s+[A-Za-z_$][\w$.]*\s*\(/.test(text.slice(finding.start))) ||
          // Upstream #151: a Markdown delimiter is not part of a template/flag.
          (finding.rule === 'context' && markdownValueExemption(finding, text)) ||
          // Upstream #152: another rule must not mask the header's scheme.
          authorizationSchemeExemption(finding, text) ||
          // Upstream #153: short re-encoded masks fall below native decode limits.
          encodedMaskExemption(text.slice(finding.start, finding.end)) ||
          // The native escaped-JSON detector does not apply exemptions to its
          // decoded findings. Verify already-clean views with the same policy.
          (finding.rule === 'encoded' && cleanEscapedView(engine, text.slice(finding.start, finding.end))) ||
          (state.wrapped && ['encoded', 'encoded-limit'].includes(finding.rule) && wrappedRanges(state, text).some(range => range.start <= finding.start && range.end >= finding.end)),
        transformation: { mode: 'hive-mask' },
        // Upstream #154: correct the type on native findings, so native merging
        // selects full redaction for key bodies. No custom rendering callback:
        // those also change the library's encoded-mask confirmation behavior.
        detectors: knownOnly ? [] : [{ detect: privateKeyTypes }],
        transformations: { PRIVATE_KEY: { mode: 'redact' } },
        ...(DEBUG ? { debug: trace } : {}),
      }),
    };
    if (sanitizers.size >= MAX_CACHED_SANITIZERS) sanitizers.delete(sanitizers.keys().next().value);
    sanitizers.set(key, engine);
  }
  return engine;
};

const cleanEscapedView = (engine, value) => {
  if (engine.state.exemptionDepth >= 3 || value.length > 256 * 1024 || !value.includes('\\')) return false;
  engine.state.exemptionDepth++;
  try {
    const decoded = JSON.parse(`"${value}"`);
    return decoded !== value && engine.sanitizer.inspect(decoded).length === 0;
  } catch {
    return false;
  } finally {
    engine.state.exemptionDepth--;
  }
};

const privateKeyTypes = text => {
  // Framing is only a fast path; all credential spans come from the library.
  if (!text.includes('-----BEGIN ') && !text.includes('PuTTY-User-Key-File-')) return [];
  return loadSensitiveDataSanitizer()
    .inspect(text)
    .filter(finding => /(?:^|[/-])private-key$/.test(finding.rule))
    .map(finding => ({ ...finding, type: 'PRIVATE_KEY' }));
};

const authorizationSchemeExemption = (finding, text) => /^[A-Za-z][A-Za-z0-9+.-]*$/.test(text.slice(finding.start, finding.end)) && /\bauthorization(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?$/i.test(text.slice(Math.max(0, finding.start - 64), finding.start)) && /^[ \t]+\S/.test(text.slice(finding.end));

const encodedMaskExemption = value => {
  if (value.length > 64 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) return false;
  return /^(?:\[REDACTED\]|[^\s…]{0,3}…[^\s…]{0,3})$/u.test(bytes.toString('utf8'));
};

const markdownValueExemption = (finding, text) => {
  const value = text.slice(finding.start, finding.end).replace(/`\s*$/, '');
  if (/^<[A-Za-z_][\w -]*>$/.test(value)) return true;
  const prefix = text.slice(Math.max(0, finding.start - 90), finding.start);
  return (/HIVE_MIND_(?:ROUTER_AUTH_GUARD|DISABLE_GIT_AUTH_TRANSPORT)\s*=\s*$/.test(prefix) && /^(?:0|1|true|false)$/.test(value)) || (/HIVE_MIND_CLAUDE_AUTH_AUTHORITY\s*=\s*$/.test(prefix) && /^(?:conventional|router)$/.test(value));
};

// Recompute after the library changes text, since earlier masks shift offsets.
const wrappedRanges = (state, text) => {
  if (state.text !== text) {
    state.text = text;
    state.ranges = findWrappedBase64Runs(text)
      .filter(({ run }) => run.length <= 256 * 1024)
      .map(({ run, index }) => ({ start: index, end: index + run.length }));
  }
  return state.ranges;
};

/** Value-free findings; offsets are UTF-16 code units. */
export const findCredentialFindings = (text, options = {}) => getSanitizer(options).sanitizer.inspect(String(text ?? ''));

/** Includes the library's own residual verification, including decoded views. */
export const sanitizeWithPolicy = (text, options = {}, depth = 0) => {
  let input = String(text ?? '');
  const engine = getSanitizer(options);
  const previousWrapped = engine.state.wrapped;
  // Upstream #149: inspect the complete wrapped payload before the library can
  // mistake an individual line for a different encoding or redact a harmless
  // image at its 8192-character limit. This decoder delegates every credential
  // decision to the engine, preserves wrapping, and matches exact known bytes.
  // Only fully inspected bounded spans suppress native encoded findings;
  // plaintext findings remain active and oversized runs still fail closed.
  const boundedWrapped = depth < 3 && input.includes('\n');
  if (boundedWrapped)
    input = sanitizeEncodedCredentials(input, {
      encodings: ['base64-wrapped'],
      knownTokens: options.knownSecrets ?? [],
      sanitizePlaintext: decoded => sanitizeWithPolicy(decoded, options, depth + 1),
    });
  try {
    engine.state.wrapped = boundedWrapped;
    const result = engine.sanitizer.sanitize(input);
    if ((result.redactions > 0 || input !== String(text ?? '')) && typeof options.onFindings === 'function') options.onFindings(Math.max(1, result.redactions));
    return result.text;
  } finally {
    engine.state.wrapped = previousWrapped;
    engine.state.text = null;
    engine.state.ranges = [];
  }
};
