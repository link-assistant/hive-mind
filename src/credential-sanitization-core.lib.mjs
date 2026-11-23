/**
 * Synchronous credential sanitization primitives used by the lowest-level
 * terminal and logging code, before asynchronous scanners such as Secretlint
 * have been initialized.
 *
 * Issues #3739 and #3740: detection and masking are done by
 * @link-foundation/sensitive-data-sanitizer. The verified adapter and reported
 * library workarounds live in ./sensitive-data-sanitizer.lib.mjs; this module adds the
 * local known-token sources, the fixed-point loop and the record-oriented stream
 * sanitizer.
 */

import { StringDecoder } from 'node:string_decoder';
import { previousRecordSeparator, wrappedBase64HoldStart } from './encoded-credential-detection.lib.mjs';
import { credentialEnvironmentValues, sanitizeWithPolicy } from './sensitive-data-sanitizer.lib.mjs';

export const CREDENTIAL_SANITIZATION_ERROR_CODE = 'ERR_CREDENTIAL_SANITIZATION';
export const CREDENTIAL_SANITIZATION_FAILURE_MESSAGE = 'Credential sanitization failed; publication was blocked.';

/**
 * Hive Mind's mask format, identical to the library's `hive-mask`
 * transformation: values longer than twelve characters keep their first and
 * last three, shorter ones become `[REDACTED]`.
 */
export const maskToken = token => {
  const value = String(token ?? '');
  if (value.length <= 12) return '[REDACTED]';
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
};

// Environment values are masked wherever they appear, whatever their shape: the
// strongest signal there is, and the only one for credentials with no
// recognizable format. The library selects and reads them (issue #3740).
const collectKnownTokenValues = options => {
  const environmentTokens = options.includeEnvironmentCredentials === false ? [] : credentialEnvironmentValues();
  const explicit = (options.knownTokens || []).map(token => (typeof token === 'string' ? token : token?.value)).filter(Boolean);
  return [...environmentTokens, ...explicit];
};

/**
 * Issue #2397: the publication boundary blocks any text that a further pass
 * would still change, so sanitization runs to a fixed point (bounded; a text
 * that still changes after that is left to the residual check).
 */
const MAX_SANITIZATION_PASSES = 3;

/**
 * Synchronously sanitize credentials in plaintext **and encoded**
 * representations (issue #2156: base64, hex, percent, escape and entity
 * encodings are decoded, sanitized and re-encoded in place by the library).
 * The operation is deterministic and idempotent.
 *
 * Options:
 * - `includeEnvironmentCredentials` (default true): mask the values of
 *   credential-named environment variables wherever they appear.
 * - `knownTokens`: additional exact values (strings or `{value}` objects).
 * - `knownOnly`: mask only the known values (plain and encoded), no pattern
 *   detection.
 * - `onFindings`: `count => void`, called with the number of masked findings
 *   of every pass that masks something (value-free, for statistics).
 *
 * @param {string} input
 * @param {{includeEnvironmentCredentials?: boolean, knownTokens?: Array<string|{value: string}>, knownOnly?: boolean, onFindings?: (count: number) => void}} [options]
 * @returns {string}
 */
export const sanitizeCredentialText = (input, options = {}) => {
  const knownSecrets = collectKnownTokenValues(options);
  const policyOptions = { knownSecrets, knownOnly: options.knownOnly === true, onFindings: options.onFindings };
  let previous = String(input ?? '');
  let output = sanitizeWithPolicy(previous, policyOptions);
  for (let pass = 1; pass < MAX_SANITIZATION_PASSES && output !== previous; pass++) {
    previous = output;
    output = sanitizeWithPolicy(previous, policyOptions);
  }
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

      const boundary = previousRecordSeparator(pending);
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
