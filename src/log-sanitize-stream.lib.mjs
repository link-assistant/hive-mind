#!/usr/bin/env node

/**
 * Streaming, bounded-memory sanitization of an execution log into a publishable
 * file (issue #2189).
 *
 * The `--attach-logs` path used to do this:
 *
 * ```js
 * const rawLogContent = await fs.readFile(logFile, 'utf8');   //  134 MB string
 * let logContent = await sanitizeForPublication(rawLogContent); // + full copy
 * logContent = escapeCodeBlocksInLog(logContent);               // + full copy
 * …
 * await writeSanitizedPublicationFile(tempLogFile, rawLogContent); // + again
 * ```
 *
 * With V8's ~2 GB old-space cap that reliably ends in
 * `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of
 * memory`, and the observed crash frame — `Runtime_RegExpExecMultiple` — is the
 * global-regex replace those passes run over the whole transcript at once.
 *
 * This module sanitizes the same content **block by block**. Peak residency is
 * one block (1 MiB by default) plus whatever the sanitizer allocates for it, so
 * a 1 GB log costs the same as a 1 MB log.
 *
 * ## Why block boundaries are safe
 *
 * Blocks are cut on record boundaries and a block is only released when the
 * bytes after it cannot belong to a credential that started inside it:
 *
 *   - a partial line is never released (a token split mid-line would be
 *     invisible to both halves);
 *   - an unterminated `-----BEGIN … PRIVATE KEY-----` block is held until its
 *     matching `-----END …-----` arrives;
 *   - a trailing run of base64-only lines is held until a line that cannot
 *     continue the blob arrives (issue #2156's wrapped-payload rule).
 *
 * This is exactly the hold-back contract {@link createCredentialStreamSanitizer}
 * already applies to child-process output; the difference is that this module
 * runs the *full* fail-closed publication sanitizer (maintained patterns +
 * Secretlint + residual re-scan) on each released block rather than the
 * dependency-free subset.
 *
 * A hold is itself capped ({@link DEFAULT_MAX_HOLD_BYTES}) so a log containing a
 * stray `-----BEGIN` marker with no terminator — or one enormous line — can
 * never reintroduce the unbounded growth this module exists to remove. Real PEM
 * keys are a few kilobytes, so the cap is unreachable by legitimate content.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-assistant/hive-mind/issues/2156
 */

import fsPromises from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { wrappedBase64HoldStart } from './encoded-credential-detection.lib.mjs';
import { sanitizeForPublication } from './token-sanitization.lib.mjs';

/** Bytes read from the source per iteration. */
export const DEFAULT_SANITIZE_CHUNK_BYTES = 1024 * 1024;

/** Hard ceiling on text held back waiting for a terminator. */
export const DEFAULT_MAX_HOLD_BYTES = 8 * 1024 * 1024;

const PEM_BEGIN_RE = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----/;

/**
 * How many characters at the head of `pending` may be released now.
 *
 * Mirrors the hold-back rules of `createCredentialStreamSanitizer`, but returns
 * the boundary instead of sanitizing, so the caller can run the asynchronous
 * publication sanitizer over the released slice.
 *
 * @param {string} pending - Buffered, not-yet-released text
 * @returns {number} Character count that is safe to release (0 = hold all)
 */
export function computeReleaseBoundary(pending) {
  if (!pending) return 0;
  const begin = PEM_BEGIN_RE.exec(pending);
  if (begin) {
    const endMarker = `-----END ${begin[1]}-----`;
    const endIndex = pending.indexOf(endMarker, begin.index + begin[0].length);
    // Everything before the marker is releasable; the key itself waits for its
    // terminator so it is always sanitized as one complete unit.
    if (endIndex < 0) return begin.index;
    return endIndex + endMarker.length;
  }
  const boundary = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r'));
  if (boundary < 0) return 0;
  const releaseEnd = wrappedBase64HoldStart(pending, boundary + 1) ?? boundary + 1;
  return Math.max(0, releaseEnd);
}

/**
 * Sanitize `sourcePath` into `destPath` without ever holding the whole file.
 *
 * The destination is created exclusively (`wx`, mode 0600) exactly like
 * {@link writeSanitizedPublicationFile}, so a pre-planted symlink in a shared
 * temporary directory cannot be followed. If any block fails the fail-closed
 * publication scan the partial destination is removed and the error rethrown —
 * a partially-sanitized file is never left behind for a caller to upload.
 *
 * @param {object} options
 * @param {string} options.sourcePath - Log to sanitize
 * @param {string} options.destPath - File to create
 * @param {number} [options.chunkBytes=DEFAULT_SANITIZE_CHUNK_BYTES]
 * @param {number} [options.maxHoldBytes=DEFAULT_MAX_HOLD_BYTES]
 * @param {Function} [options.sanitize=sanitizeForPublication] - `(text) => Promise<string>`
 * @param {Function} [options.transform] - Optional per-block post-transform (e.g. markdown escaping)
 * @param {object} [options.fsImpl=fsPromises]
 * @param {Function} [options.onProgress] - `({bytesRead, sourceSize, blocks}) => void`
 * @returns {Promise<{sourceSize: number, bytesRead: number, charsWritten: number, blocks: number, forcedReleases: number}>}
 */
export async function sanitizeLogFileToFile(options = {}) {
  const { sourcePath, destPath, chunkBytes = DEFAULT_SANITIZE_CHUNK_BYTES, maxHoldBytes = DEFAULT_MAX_HOLD_BYTES, sanitize = sanitizeForPublication, transform = null, fsImpl = fsPromises, onProgress = null } = options;
  if (!sourcePath) throw new TypeError('sanitizeLogFileToFile requires a sourcePath');
  if (!destPath) throw new TypeError('sanitizeLogFileToFile requires a destPath');

  const step = Number.isFinite(chunkBytes) && chunkBytes > 0 ? Math.floor(chunkBytes) : DEFAULT_SANITIZE_CHUNK_BYTES;
  const holdCap = Number.isFinite(maxHoldBytes) && maxHoldBytes > 0 ? Math.floor(maxHoldBytes) : DEFAULT_MAX_HOLD_BYTES;

  const stats = { sourceSize: 0, bytesRead: 0, charsWritten: 0, blocks: 0, forcedReleases: 0 };
  let source = null;
  let dest = null;
  let destCreated = false;

  try {
    source = await fsImpl.open(sourcePath, 'r');
    stats.sourceSize = (await source.stat()).size;
    dest = await fsImpl.open(destPath, 'wx', 0o600);
    destCreated = true;

    const buffer = Buffer.alloc(step);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let position = 0;

    const emit = async text => {
      if (!text) return;
      const sanitized = String(await sanitize(text));
      const out = transform ? String(transform(sanitized)) : sanitized;
      if (!out) return;
      await dest.write(out, null, 'utf8');
      stats.charsWritten += out.length;
      stats.blocks += 1;
    };

    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, step, position);
      if (!bytesRead) break;
      position += bytesRead;
      stats.bytesRead = position;
      pending += decoder.write(buffer.subarray(0, bytesRead));

      let boundary = computeReleaseBoundary(pending);
      if (boundary <= 0 && pending.length > holdCap) {
        // Never grow without bound: fall back to the last record boundary, or
        // the whole buffer when the file has no record boundary at all.
        const lastRecord = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r'));
        boundary = lastRecord >= 0 ? lastRecord + 1 : pending.length;
        stats.forcedReleases += 1;
      }
      if (boundary > 0) {
        await emit(pending.slice(0, boundary));
        pending = pending.slice(boundary);
      }
      if (onProgress) onProgress({ bytesRead: position, sourceSize: stats.sourceSize, blocks: stats.blocks });
    }

    pending += decoder.end();
    await emit(pending);
    await dest.chmod(0o600);
    return stats;
  } catch (error) {
    if (destCreated) {
      try {
        if (dest) await dest.close();
      } catch {
        /* closing a failed handle is best effort */
      }
      dest = null;
      await fsImpl.unlink(destPath).catch(() => {});
    }
    throw error;
  } finally {
    if (source) await source.close().catch(() => {});
    if (dest) await dest.close().catch(() => {});
  }
}
