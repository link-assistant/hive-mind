#!/usr/bin/env node

/**
 * Issue #4042: gh-upload-log sanitizes every file again before uploading it,
 * with its own sensitive-data-sanitizer. Up to 0.13.1 it pinned 0.12.1, which
 * refused a record over 64 MiB and dense base64 with `Sanitization failed
 * (ERR_LIMIT)`, even after Hive Mind already sanitized the file. The refusal
 * depends only on the bytes, so retrying them can never succeed: on
 * link-assistant/router#785 a 399 MB log got 6 identical refusals.
 *
 * gh-upload-log 0.13.2 (link-foundation/gh-upload-log#63) removes both limits
 * and says whether a failure can clear: `Sanitization failed (CODE) (details);
 * retryable|not retryable; nothing was uploaded`, exit 75 or 65. Retryable
 * codes (ERR_INPUT_CHANGED, ENOSPC, EAGAIN, …) are local and transient, so they
 * are not refusals. One deterministic refusal is left: `ERR_SANITIZATION` on an
 * ASCII letter/digit run of about 4 MiB near a non-Latin-1 character
 * (link-foundation/sensitive-data-sanitizer#172); the part splitter in
 * log-upload.lib.mjs isolates such runs (LOG_UPLOAD_ISOLATED_RUN_BYTES).
 *
 * Kept free of side effects so both the uploader and the failure comment can
 * import it.
 */

// Upstream report: pinned sanitizer, 64 MiB record limit, one ambiguous code (fixed in 0.13.2).
export const GH_UPLOAD_LOG_REFUSAL_ISSUE_URL = 'https://github.com/link-foundation/gh-upload-log/issues/63';

// The library bug that still makes 0.13.2 refuse a file (ERR_SANITIZATION).
export const GH_UPLOAD_LOG_LONG_RUN_ISSUE_URL = 'https://github.com/link-foundation/sensitive-data-sanitizer/issues/172';

// The first release that removes the 64 MiB record and dense-base64 limits.
export const GH_UPLOAD_LOG_FIXED_VERSION = '0.13.2';

// gh-upload-log 0.13.1 and older refuse any single record (line) over 64 MiB.
export const GH_UPLOAD_LOG_MAX_RECORD_BYTES = 64 * 1024 * 1024;

// Upper bound for one uploaded part, with margin below the old record limit.
export const LOG_UPLOAD_MAX_PART_BYTES = 48 * 1024 * 1024;

// No part holds more than this much of one ASCII letter/digit run together with
// a non-ASCII byte; the #172 overflow starts at about 3–4 MiB.
export const LOG_UPLOAD_ISOLATED_RUN_BYTES = 1024 * 1024;

/**
 * @param {string} output - gh-upload-log output, or a summary of it.
 * @returns {string|null} The refusal code (e.g. "ERR_LIMIT"), or null when
 *   there is none or gh-upload-log says the failure is retryable.
 */
export const detectGhUploadLogSanitizerRefusal = output => {
  const text = String(output || '');
  const match = /Sanitization failed \((ERR_[A-Z_]+|E[A-Z0-9]+)\)([^\n]*)/.exec(text);
  if (!match) return null;
  // 0.13.2 marks transient local failures; never treat them as deterministic.
  if (/;\s*retryable;/.test(match[2]) || match[1] === 'ERR_INPUT_CHANGED') return null;
  return match[1];
};
