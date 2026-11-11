#!/usr/bin/env node

/**
 * Issue #4042: gh-upload-log sanitizes every file again before uploading it,
 * with its own pinned sensitive-data-sanitizer (0.12.1 in gh-upload-log 0.13.1).
 * That engine refuses a record over 64 MiB and dense base64 (more than 4096
 * encoded candidates in one region) with `Sanitization failed (ERR_LIMIT)`,
 * even after Hive Mind already sanitized the file. The refusal depends only on
 * the bytes, so retrying them can never succeed: on link-assistant/router#785 a
 * 399 MB log got 6 identical refusals.
 *
 * Kept free of side effects so both the uploader and the failure comment can
 * import it.
 */

// Upstream report: pinned sanitizer, 64 MiB record limit, one ambiguous code.
export const GH_UPLOAD_LOG_REFUSAL_ISSUE_URL = 'https://github.com/link-foundation/gh-upload-log/issues/63';

// gh-upload-log 0.13.1 refuses any single record (line) over 64 MiB.
export const GH_UPLOAD_LOG_MAX_RECORD_BYTES = 64 * 1024 * 1024;

// Upper bound for one uploaded part, with margin below the record limit.
export const LOG_UPLOAD_MAX_PART_BYTES = 48 * 1024 * 1024;

/**
 * @param {string} output - gh-upload-log output, or a summary of it.
 * @returns {string|null} The refusal code (e.g. "ERR_LIMIT"), or null.
 */
export const detectGhUploadLogSanitizerRefusal = output => /Sanitization failed \((ERR_[A-Z_]+)\)/.exec(String(output || ''))?.[1] || null;
