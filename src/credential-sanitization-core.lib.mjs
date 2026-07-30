/**
 * Dependency-free credential sanitization primitives.
 *
 * This module deliberately has no project imports. It is safe to use from the
 * lowest-level terminal and logging code, before asynchronous scanners such as
 * Secretlint have been initialized.
 */

import { StringDecoder } from 'node:string_decoder';

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

const SENSITIVE_KEY = String.raw`(?:[A-Za-z0-9_.-]*(?:api[-_]?key|account[-_]?key|client[-_]?secret|consumer[-_]?secret|webhook[-_]?secret|access[-_]?token|refresh[-_]?token|auth[-_]?token|password|passwd|pwd|private[-_]?key|secret|token|session[-_]?key|session[-_]?token|cookie|docker[-_]?auth|registry[-_]?auth|shared[-_]?access[-_]?signature|sas[-_]?token)[A-Za-z0-9_.-]*|auth|authorization)`;

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
const SENSITIVE_ENV_NAME = /(?:API_?KEY|ACCOUNT_?KEY|CLIENT_?SECRET|CONSUMER_?SECRET|WEBHOOK_?SECRET|ACCESS_?TOKEN|REFRESH_?TOKEN|AUTH_?TOKEN|PASSWORD|PASSWD|PRIVATE_?KEY|SECRET|TOKEN|COOKIE|AUTH)$/i;
const QUOTED_ASSIGNMENT = new RegExp(`((?:["']?${SENSITIVE_KEY}["']?)\\s*(?:=>|[:=])\\s*)(["'])([^"'\\r\\n]*)(\\2)`, 'gi');
// Issue #2119: a value that *opens* a JSON/JS structure is punctuation, not a
// secret. Without this guard `"tokens": {` was rewritten to `"tokens": [REDACTED]`,
// which silently truncated the object and made the whole record unparseable.
// The guard only rejects a structural character in first position, so a
// credential that merely contains a brace (`password=ab{cd`) is still masked whole.
const UNQUOTED_ASSIGNMENT = new RegExp(`((?:["']?${SENSITIVE_KEY}["']?)\\s*(?:=>|[:=])\\s*)(?!["']|[{[]|(?:Bearer|Basic|SharedAccessSignature)\\s)([^\\s,;}&'"\\r\\n]+)`, 'gi');
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
 * structured values. The operation is deterministic and idempotent.
 */
export const sanitizeCredentialText = (input, options = {}) => {
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
  output = output.replace(QUOTED_ASSIGNMENT, (match, prefix, quote, value) => (isTokenCounterAssignment(prefix, value) ? match : `${prefix}${quote}${maskValue(value)}${quote}`));
  output = output.replace(UNQUOTED_ASSIGNMENT, (match, prefix, value) => (isTokenCounterAssignment(prefix, value) ? match : `${prefix}${maskValue(value)}`));

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
      output += sanitizeCredentialText(pending.slice(0, boundary + 1), options);
      pending = pending.slice(boundary + 1);
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
