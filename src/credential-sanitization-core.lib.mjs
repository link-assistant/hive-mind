/**
 * Dependency-free credential sanitization primitives.
 *
 * This module deliberately has no project imports. It is safe to use from the
 * lowest-level terminal and logging code, before asynchronous scanners such as
 * Secretlint have been initialized.
 */

import { StringDecoder } from 'node:string_decoder';
import { sanitizeEncodedCredentials, wrappedBase64HoldStart } from './encoded-credential-detection.lib.mjs';

export const CREDENTIAL_SANITIZATION_ERROR_CODE = 'ERR_CREDENTIAL_SANITIZATION';
export const CREDENTIAL_SANITIZATION_FAILURE_MESSAGE = 'Credential sanitization failed; publication was blocked.';

const MASKED_VALUE = /^(?:\[REDACTED\]|.{3}….{3})$/u;

export const maskToken = token => {
  const value = String(token ?? '');
  if (value.length <= 12) return '[REDACTED]';
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
};

const maskValue = value => {
  if (!value || MASKED_VALUE.test(value)) return value;
  return maskToken(value);
};

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const VENDOR_PATTERNS = Object.freeze([
  // GitHub: classic, fine-grained, OAuth, user-to-server, server-to-server,
  // refresh, and the stateless server token family.
  /\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}\b/g,
  /\bghs_[A-Za-z0-9_]{16,}\b/g,
  // GitLab personal/project/group/access, OAuth, deploy, runner, CI,
  // feature-flag, session and agent token families.
  /\b(?:glpat|gloas|gldt|glrt|glrtr|glcbt|glptt|glft|glimt|glagent|glwt|glsoat|glffct)-[A-Za-z0-9_-]{16,}\b/g,
  // OpenAI and Anthropic.
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{16,}\b/g,
  // AWS access-key IDs. Secret keys and session tokens are caught by their
  // assignment/header context below.
  /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
  // Google/GCP API keys and OAuth client secrets.
  /\bAIza[0-9A-Za-z_-]{32,40}\b/g,
  /\bGOCSPX-[0-9A-Za-z_-]{16,}\b/g,
  // Azure application secrets are additionally caught by generic key names
  // such as AccountKey and client_secret. SAS values need a structured rule
  // below so the SharedAccessSignature scheme remains visible.
  // Slack app, bot, user, workspace and configuration tokens.
  /\b(?:xox[a-z]|xapp|xwfp)-[0-9A-Za-z-]{20,}\b/g,
  // Stripe secret/restricted/publishable keys and webhook signing secrets.
  /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  /\bwhsec_[0-9A-Za-z]{16,}\b/g,
  // SendGrid, Twilio, npm and PyPI.
  /\bSG\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{20,}\b/g,
  /\bSK[0-9a-fA-F]{32}\b/g,
  /\bnpm_[0-9A-Za-z]{20,}\b/g,
  /\bpypi-[0-9A-Za-z_-]{30,}\b/g,
  // Telegram, Discord, Hugging Face and common additional service formats.
  /\b[0-9]{8,12}:[0-9A-Za-z_-]{30,}\b/g,
  /\b[MN][0-9A-Za-z_-]{23,}\.[0-9A-Za-z_-]{6}\.[0-9A-Za-z_-]{20,}\b/g,
  /\bhf_[0-9A-Za-z]{20,}\b/g,
  /\bshpat_[0-9a-fA-F]{32}\b/g,
  /\bdapi[0-9a-fA-F]{32}\b/g,
  /\bsq0(?:atp|csp)-[0-9A-Za-z_-]{20,}\b/g,
  // JWT/JWS access, ID, and CI job tokens.
  /\beyJ[0-9A-Za-z_-]{8,}\.eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\b/g,
  // Opaque CI/test credentials sometimes carry only an all-caps semantic
  // marker and appear without a useful assignment name.
  /\b(?:[A-Z0-9]+[_-])+(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY)(?:[_-][A-Z0-9]+)+\b/g,
]);

// The affixes around the sensitive word are bounded rather than `*`. Unbounded
// they made every assignment rule quadratic: at each of the N starting offsets
// in a long identifier-shaped run the engine consumed to the end and then
// backtracked one character at a time looking for the sensitive word. A single
// 64 KB base64 blob — routine in a published log — took 19 s per rule and a
// 256 KB one never finished, which turns the fail-closed publication path into
// a hang. Bounding costs nothing in coverage: a key whose affix is longer than
// this simply matches from a later offset, and the affix is preserved text
// rather than masked content, so the sanitized output is identical.
const MAX_KEY_AFFIX = 64;
const SENSITIVE_KEY = String.raw`(?:[A-Za-z0-9_.-]{0,${MAX_KEY_AFFIX}}(?:api[-_]?key|account[-_]?key|client[-_]?secret|consumer[-_]?secret|webhook[-_]?secret|access[-_]?token|refresh[-_]?token|auth[-_]?token|password|passwd|pwd|private[-_]?key|secret|token|session[-_]?key|session[-_]?token|cookie|docker[-_]?auth|registry[-_]?auth|shared[-_]?access[-_]?signature|sas[-_]?token)[A-Za-z0-9_.-]{0,${MAX_KEY_AFFIX}}|auth|authorization)`;

// Issue #2119: token *accounting* is not a credential. Every AI provider SDK
// spells usage telemetry with the plural "tokens" (`tokens`, `inputTokens`,
// `prompt_tokens`, `total_tokens`) or with an explicit quantity suffix
// (`token_count`, `tokenLimit`). Masking those numbers corrupted the NDJSON
// telemetry in published logs and destroyed token/cost accounting, while
// protecting nothing: a credential is never a bare number under a plural name.
// The exemption stays deliberately narrow - it requires both a counter-shaped
// key and a purely numeric value, so `access_token=123456` is still masked.
const TOKEN_COUNTER_KEY = /(?:tokens|token(?:count|limit|usage|budget|used|size|s?remaining)|(?:count|limit|usage|budget|used|size)tokens?)$/;
const NUMERIC_VALUE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;

const normalizeAssignmentKey = prefix =>
  String(prefix ?? '')
    .replace(/\s*(?:=>|[:=])\s*$/, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

const isTokenCounterAssignment = (prefix, value) => NUMERIC_VALUE.test(String(value ?? '').trim()) && TOKEN_COUNTER_KEY.test(normalizeAssignmentKey(prefix));

// Issue #2156: `SENSITIVE_KEY` matches any key *containing* `secret`, `token`
// or `auth`, which includes real npm package names — `secretlint`,
// `@secretlint/secretlint-rule-preset-recommend`, `next-auth`. Their manifest
// values are version ranges, and masking those rewrote dependency versions to
// `[REDACTED]` in every published `package.json` excerpt. A credential is
// never a bare semver range, so exempting that exact value shape costs no
// protection. The guard is on the value alone; `token: "1.2.3"` in a real
// credential field would be a 5-character value that `maskToken` reduces to
// `[REDACTED]` anyway.
// One comparator (`^1.2.3`, `>=4.0.0`, `v2.1`), optionally repeated as a range
// joined by whitespace, `-` or `||` — the full npm/semver range grammar.
const VERSION_COMPARATOR = String.raw`(?:\^|~|[><]=?|=)?\s*v?\d+(?:\.\d+){1,2}(?:[-+][0-9A-Za-z.-]+)?`;
const VERSION_RANGE_VALUE = new RegExp(`^${VERSION_COMPARATOR}(?:(?:\\s*(?:\\|\\||-)\\s*|\\s+)${VERSION_COMPARATOR})*$`);
const isVersionRangeAssignment = value => VERSION_RANGE_VALUE.test(String(value ?? '').trim());
const SENSITIVE_ENV_NAME = /(?:API_?KEY|ACCOUNT_?KEY|CLIENT_?SECRET|CONSUMER_?SECRET|WEBHOOK_?SECRET|ACCESS_?TOKEN|REFRESH_?TOKEN|AUTH_?TOKEN|PASSWORD|PASSWD|PRIVATE_?KEY|SECRET|TOKEN|COOKIE|AUTH)$/i;
// Issue #2156: structured output is routinely nested inside another JSON
// document — an agent tool result embeds the command's stdout as a JSON
// *string*, so a response body reaches the log as `{\"token\":\"...\"}` with
// every quote backslash-escaped. Anchoring on a bare `"` missed all of those,
// which meant the generic `token` / `password` / `api_key` rules silently did
// nothing for the single most common shape in our own logs. A quote delimiter
// is therefore any run of backslashes followed by a quote character, and the
// value is matched lazily so it stops at the escape rather than swallowing it.
const QUOTE = String.raw`\\*["']`;
const QUOTED_ASSIGNMENT = new RegExp(`((?:${QUOTE})?${SENSITIVE_KEY}(?:${QUOTE})?\\s*(?:=>|[:=])\\s*)(${QUOTE})([^"'\\r\\n]*?)(${QUOTE})`, 'gi');
// Issue #2119: a value that *opens* a JSON/JS structure is punctuation, not a
// secret. Without this guard `"tokens": {` was rewritten to `"tokens": [REDACTED]`,
// which silently truncated the object and made the whole record unparseable.
// The guard only rejects a structural character in first position, so a
// credential that merely contains a brace (`password=ab{cd`) is still masked whole.
const UNQUOTED_ASSIGNMENT = new RegExp(`((?:${QUOTE})?${SENSITIVE_KEY}(?:${QUOTE})?\\s*(?:=>|[:=])\\s*)(?!${QUOTE}|[{[]|(?:Bearer|Basic|SharedAccessSignature)\\s)([^\\s,;}&'"\\r\\n]+)`, 'gi');
const XML_CREDENTIAL = new RegExp(`(<(${SENSITIVE_KEY})\\b[^>]*>)([\\s\\S]*?)(<\\/\\2\\s*>)`, 'gi');
const CLI_CREDENTIAL_QUOTED = new RegExp(`(--${SENSITIVE_KEY}(?:\\s+|=))(["'])([^"'\\r\\n]*)(\\2)`, 'gi');
const CLI_CREDENTIAL = new RegExp(`(--${SENSITIVE_KEY}(?:\\s+|=))(?!["'])([^\\s"'\\r\\n]+)`, 'gi');
const QUERY_CREDENTIAL = new RegExp(`([?&]${SENSITIVE_KEY}=)([^&#\\s]+)`, 'gi');

const replaceVendorSecrets = text => {
  let output = text;
  for (const pattern of VENDOR_PATTERNS) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, match => maskValue(match));
  }
  return output;
};

const replaceCookieHeader = (_match, prefix, cookieText) => {
  const sanitized = cookieText.replace(/(^|;\s*)([^=;\s]+)(=)([^;\r\n]*)/g, (pair, separator, name, equals, value) => {
    return `${separator}${name}${equals}${maskValue(value.trim())}`;
  });
  return `${prefix}${sanitized}`;
};

/**
 * Synchronously sanitize known vendor credentials and credential-like
 * structured values in their plaintext representation.
 *
 * Encoded representations are handled by {@link sanitizeCredentialText}, which
 * wraps this function; keeping the plaintext rules separate is what lets the
 * encoded layer call back into them without recursing forever.
 */
const sanitizePlaintextCredentials = (input, options = {}) => {
  let output = String(input ?? '');

  // Known active credentials are the strongest signal and are replaced before
  // format matching, regardless of their shape or length.
  const environmentTokens =
    options.includeEnvironmentCredentials === false
      ? []
      : Object.entries(process.env)
          .filter(([name, value]) => SENSITIVE_ENV_NAME.test(name) && typeof value === 'string' && value.length > 0)
          .map(([, value]) => value);
  for (const token of [...environmentTokens, ...(options.knownTokens || [])]) {
    const value = typeof token === 'string' ? token : token?.value;
    if (!value || !output.includes(value)) continue;
    output = output.replace(new RegExp(escapeRegExp(value), 'g'), maskValue(value));
  }

  // Keep PEM markers for diagnostic context, but never preserve key material.
  output = output.replace(/(-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----)[\s\S]*?(-----END \2-----)/g, (_match, begin, _label, end) => `${begin}\n[REDACTED]\n${end}`);
  // An interrupted process may never print the closing PEM marker. Treat the
  // remainder as key material instead of releasing it during stream flush.
  output = output.replace(/(-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----)(?![\s\S]*?-----END \2-----)[\s\S]*/g, '$1\n[REDACTED]');

  output = replaceVendorSecrets(output);

  // Authentication headers and URL credentials.
  output = output.replace(/((?:Proxy-)?Authorization\s*:\s*(?:Bearer|Basic)\s+)([^\s"',;]+)/gi, (_match, prefix, value) => `${prefix}${maskValue(value)}`);
  output = output.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, (_match, prefix, value, suffix) => `${prefix}${maskValue(value)}${suffix}`);
  output = output.replace(/(\bSharedAccessSignature\s+)(sr=[^\s,;]+(?:&[^\s,;]+)+)/gi, (_match, prefix, value) => `${prefix}${maskValue(value)}`);
  output = output.replace(/(\bSharedAccessSignature\s*=\s*)([^\s"',;]+)/gi, (_match, prefix, value) => `${prefix}${maskValue(value)}`);

  // Cookie values are credentials at output boundaries even when their names
  // are vendor-specific and therefore unknown to us.
  output = output.replace(/((?:Set-)?Cookie\s*:\s*)([^\r\n]*)/gi, replaceCookieHeader);

  // XML and JSON/YAML/TOML/INI/shell-style assignments.
  output = output.replace(XML_CREDENTIAL, (_match, start, _key, value, end) => `${start}${maskValue(value.trim())}${end}`);
  // The opening and closing delimiters are captured independently because an
  // escaped payload may not balance them symmetrically; each is preserved as
  // written so the surrounding document stays byte-for-byte parseable.
  output = output.replace(QUOTED_ASSIGNMENT, (match, prefix, openQuote, value, closeQuote) => (isTokenCounterAssignment(prefix, value) || isVersionRangeAssignment(value) ? match : `${prefix}${openQuote}${maskValue(value)}${closeQuote}`));
  output = output.replace(UNQUOTED_ASSIGNMENT, (match, prefix, value) => (isTokenCounterAssignment(prefix, value) || isVersionRangeAssignment(value) ? match : `${prefix}${maskValue(value)}`));

  // CLI arguments and sensitive query parameters.
  output = output.replace(CLI_CREDENTIAL_QUOTED, (_match, prefix, quote, value) => `${prefix}${quote}${maskValue(value)}${quote}`);
  output = output.replace(CLI_CREDENTIAL, (_match, prefix, value) => `${prefix}${maskValue(value)}`);
  output = output.replace(QUERY_CREDENTIAL, (_match, prefix, value) => `${prefix}${maskValue(value)}`);

  // Vendor webhook URLs encode credentials in their path rather than a named
  // field. Preserve the service endpoint and sanitize only the credential.
  output = output.replace(/(https:\/\/hooks\.slack\.com\/services\/)([0-9A-Za-z/_-]+)/gi, (_match, prefix, value) => `${prefix}${maskValue(value)}`);
  output = output.replace(/(https:\/\/(?:canary\.)?discord(?:app)?\.com\/api\/webhooks\/)([0-9A-Za-z/_-]+)/gi, (_match, prefix, value) => `${prefix}${maskValue(value)}`);

  return output;
};

/**
 * How many nested encoding layers to peel. A credential wrapped in base64 of
 * base64 is still a credential; beyond three layers the payload is no longer
 * something any real service produces.
 */
const MAX_ENCODED_SANITIZATION_DEPTH = 3;

const collectKnownTokenValues = options => {
  const environmentTokens =
    options.includeEnvironmentCredentials === false
      ? []
      : Object.entries(process.env)
          .filter(([name, value]) => SENSITIVE_ENV_NAME.test(name) && typeof value === 'string' && value.length > 0)
          .map(([, value]) => value);
  const explicit = (options.knownTokens || []).map(token => (typeof token === 'string' ? token : token?.value)).filter(Boolean);
  return [...environmentTokens, ...explicit];
};

/**
 * Synchronously sanitize known vendor credentials and credential-like
 * structured values, in both plaintext **and encoded** representations. The
 * operation is deterministic and idempotent.
 *
 * Issue #2156: a credential that reaches a log only as base64 (or hex, percent,
 * escape or entity encoding) has no plaintext substring for the rules above to
 * match, yet remains fully recoverable — and GitHub's secret scanning does
 * recover it. Encoded runs are therefore decoded, sanitized with the same
 * rules, and re-encoded in place.
 */
export const sanitizeCredentialText = (input, options = {}) => {
  const knownTokens = collectKnownTokenValues(options);

  const sanitizeAtDepth = (text, depth) => {
    const plain = sanitizePlaintextCredentials(text, options);
    if (depth >= MAX_ENCODED_SANITIZATION_DEPTH || options.skipEncodedCredentials === true) return plain;
    return sanitizeEncodedCredentials(plain, {
      knownTokens,
      sanitizePlaintext: nested => sanitizeAtDepth(nested, depth + 1),
    });
  };

  return sanitizeAtDepth(String(input ?? ''), 0);
};

/**
 * Return a non-sensitive indication that another sanitizer pass would change
 * the text. Callers never receive the matching value.
 */
export const findCredentialResiduals = input => {
  const text = String(input ?? '');
  return sanitizeCredentialText(text) === text ? [] : [{ ruleId: 'credential-pattern' }];
};

/**
 * Record-oriented sanitizer for child-process stdout/stderr chunks. An
 * incomplete record is retained until a newline arrives (or flush is called),
 * so credentials split at arbitrary chunk boundaries are never emitted raw.
 */
export const createCredentialStreamSanitizer = options => {
  let pending = '';
  let decoder = new StringDecoder('utf8');

  const appendChunk = chunk => {
    if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      pending += decoder.write(bytes);
      return;
    }
    pending += decoder.end();
    decoder = new StringDecoder('utf8');
    pending += String(chunk ?? '');
  };

  const drain = () => {
    let output = '';
    const beginPattern = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----/;

    while (pending) {
      const begin = beginPattern.exec(pending);
      if (begin) {
        const endMarker = `-----END ${begin[1]}-----`;
        const endIndex = pending.indexOf(endMarker, begin.index + begin[0].length);
        if (endIndex < 0) {
          // Text before the marker can be released, but the marker and every
          // following byte stay private until the matching end or flush.
          if (begin.index > 0) {
            output += sanitizeCredentialText(pending.slice(0, begin.index), options);
            pending = pending.slice(begin.index);
          }
          break;
        }

        const keyEnd = endIndex + endMarker.length;
        output += sanitizeCredentialText(pending.slice(0, keyEnd), options);
        pending = pending.slice(keyEnd);
        continue;
      }

      const boundary = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r'));
      if (boundary < 0) break;

      // Issue #2156: a base64 blob wrapped across lines is one credential
      // carrier spread over many records. Releasing those records one at a time
      // hands the sanitizer a byte-misaligned slice that decodes to noise, so
      // hold a trailing group of base64-only lines back until a line that
      // cannot belong to the blob arrives (or `flush` forces the issue), the
      // same way an unterminated PEM block is held above.
      const releaseEnd = wrappedBase64HoldStart(pending, boundary + 1) ?? boundary + 1;
      if (releaseEnd <= 0) break;
      output += sanitizeCredentialText(pending.slice(0, releaseEnd), options);
      pending = pending.slice(releaseEnd);
    }

    return output;
  };

  return {
    write(chunk) {
      appendChunk(chunk);
      return drain();
    },
    flush() {
      pending += decoder.end();
      decoder = new StringDecoder('utf8');
      const complete = pending;
      pending = '';
      return sanitizeCredentialText(complete, options);
    },
  };
};
