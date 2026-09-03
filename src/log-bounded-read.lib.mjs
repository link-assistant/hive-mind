#!/usr/bin/env node

/**
 * Bounded-memory readers for execution logs (issue #2189).
 *
 * A `/solve` execution log is unbounded by construction: it is the verbatim
 * transcript of an AI tool that may run for a day. The incident that motivated
 * this module produced a **134 MB** log, and every completion-time helper that
 * wanted a single fact out of it did `await fs.readFile(logPath, 'utf8')` —
 * materialising the whole transcript as one JS string, four separate times per
 * monitor tick, against V8's ~2 GB old-space cap. The run died with
 * `FATAL ERROR: Reached heap limit` while the machine still had 10 GB free.
 *
 * Every reader here is bounded by construction:
 *
 *   - {@link readLogHeadText} / {@link readLogTailText} read at most `maxBytes`
 *     from one end of the file.
 *   - {@link readLogTextBounded} returns the whole file while it is small and
 *     otherwise a head + tail excerpt with an explicit truncation marker, so
 *     marker-style parsers (`📊 [DISK]`, kill diagnostics, …) keep working on
 *     both ends of the transcript without ever holding the middle.
 *   - {@link scanLogChunks} streams the file forward in overlapping chunks and
 *     stops at the first chunk that answers the caller's question, so a scan
 *     that must cover the *whole* log still holds only one chunk at a time.
 *   - {@link forEachLogLine} streams a record-per-line file (JSONL transcripts)
 *     one line at a time, so peak residency is one line instead of the file plus
 *     the array of its lines.
 *
 * All readers are non-throwing: a missing or unreadable log yields the caller's
 * empty value, exactly like the `readFile`-based code they replace.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import fsPromises from 'node:fs/promises';
import { createReadStream as fsCreateReadStream } from 'node:fs';
import readline from 'node:readline';

/** Default ceiling for "read the log as text" helpers (head + tail combined). */
export const DEFAULT_BOUNDED_LOG_BYTES = 4 * 1024 * 1024;

/** Default size of one forward scan chunk. */
export const DEFAULT_LOG_CHUNK_BYTES = 1024 * 1024;

/**
 * Overlap between adjacent scan chunks so a marker split across a chunk
 * boundary is still matched exactly once by the chunk that follows it.
 */
export const LOG_CHUNK_OVERLAP_BYTES = 8192;

/** Marker inserted between the head and tail excerpts of a truncated read. */
export const LOG_TRUNCATION_MARKER = '\n…[log truncated: middle omitted by bounded reader, see full log file]…\n';

const toPositiveInt = (value, fallback) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback);

/**
 * Read a byte range of a file as UTF-8 text using a single file handle.
 *
 * @param {object} fsImpl - fs.promises-compatible implementation
 * @param {string} logPath
 * @param {number} position - Byte offset to start at
 * @param {number} length - Number of bytes to read
 * @returns {Promise<string>}
 */
async function readRangeText(fsImpl, logPath, position, length) {
  if (length <= 0) return '';
  const handle = await fsImpl.open(logPath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Read at most `maxBytes` from the START of a log file.
 *
 * @param {string} logPath
 * @param {object} [options]
 * @param {object} [options.fsImpl=fsPromises]
 * @param {number} [options.maxBytes=DEFAULT_BOUNDED_LOG_BYTES]
 * @returns {Promise<string>} Text (empty when the log cannot be read)
 */
export async function readLogHeadText(logPath, { fsImpl = fsPromises, maxBytes = DEFAULT_BOUNDED_LOG_BYTES } = {}) {
  if (!logPath) return '';
  try {
    const { size } = await fsImpl.stat(logPath);
    return await readRangeText(fsImpl, logPath, 0, Math.min(size, toPositiveInt(maxBytes, DEFAULT_BOUNDED_LOG_BYTES)));
  } catch {
    return '';
  }
}

/**
 * Read at most `maxBytes` from the END of a log file. The excerpt is aligned to
 * the first newline inside the window so a caller never sees half a line.
 *
 * @param {string} logPath
 * @param {object} [options]
 * @param {object} [options.fsImpl=fsPromises]
 * @param {number} [options.maxBytes=DEFAULT_BOUNDED_LOG_BYTES]
 * @returns {Promise<string>} Text (empty when the log cannot be read)
 */
export async function readLogTailText(logPath, { fsImpl = fsPromises, maxBytes = DEFAULT_BOUNDED_LOG_BYTES } = {}) {
  if (!logPath) return '';
  try {
    const { size } = await fsImpl.stat(logPath);
    const limit = Math.min(size, toPositiveInt(maxBytes, DEFAULT_BOUNDED_LOG_BYTES));
    const start = Math.max(0, size - limit);
    const text = await readRangeText(fsImpl, logPath, start, limit);
    if (start === 0) return text;
    const firstNewline = text.indexOf('\n');
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
  } catch {
    return '';
  }
}

/**
 * Read a log as text without ever holding more than `maxBytes` of it.
 *
 * Small logs are returned verbatim. Larger logs are returned as
 * `head + LOG_TRUNCATION_MARKER + tail`, each half being `maxBytes / 2`. That
 * shape is deliberate: the facts completion-time reporting needs (start-up
 * banner, `📊 [DISK] phase=after_clone`, the exit footer, `📊 [DISK]
 * phase=after_agent`, crash stacks) live at the two ends of a transcript.
 *
 * `readFile` stays injectable so existing unit tests can keep handing these
 * helpers a synthetic reader; it is used whenever `stat` cannot size the file.
 *
 * @param {string} logPath
 * @param {object} [options]
 * @param {object} [options.fsImpl=fsPromises]
 * @param {Function} [options.readFile] - Injectable whole-file reader for small logs/tests
 * @param {number} [options.maxBytes=DEFAULT_BOUNDED_LOG_BYTES]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<string>} Text (empty when the log cannot be read)
 */
export async function readLogTextBounded(logPath, { fsImpl = fsPromises, readFile = null, maxBytes = DEFAULT_BOUNDED_LOG_BYTES, verbose = false } = {}) {
  if (!logPath) return '';
  const limit = toPositiveInt(maxBytes, DEFAULT_BOUNDED_LOG_BYTES);
  const read = readFile || fsImpl.readFile.bind(fsImpl);
  let size = null;
  try {
    size = (await fsImpl.stat(logPath)).size;
  } catch {
    // A caller-injected reader may serve paths that do not exist on disk, so an
    // unstattable path is not an error — `size` simply stays null and the whole
    // "file" is handed to that reader below.
  }
  if (size === null || size <= limit) {
    try {
      return String(await read(logPath, 'utf8'));
    } catch (error) {
      if (verbose) console.log(`[VERBOSE] log-bounded-read: could not read ${logPath}: ${error?.message || error}`);
      return '';
    }
  }
  const half = Math.max(1, Math.floor(limit / 2));
  const head = await readLogHeadText(logPath, { fsImpl, maxBytes: half });
  const tail = await readLogTailText(logPath, { fsImpl, maxBytes: half });
  if (verbose) {
    console.log(`[VERBOSE] log-bounded-read: ${logPath} is ${size} bytes; using ${head.length}+${tail.length} char head/tail excerpt`);
  }
  return `${head}${LOG_TRUNCATION_MARKER}${tail}`;
}

/**
 * Stream a log forward in overlapping chunks, stopping as soon as `onChunk`
 * returns a value that is neither `undefined` nor `null`.
 *
 * Only one chunk (plus the overlap carried from the previous one) is resident
 * at a time, so this covers a log of any size in constant memory.
 *
 * @param {string} logPath
 * @param {Function} onChunk - `(text, {offset, isFirst, isLast}) => any`
 * @param {object} [options]
 * @param {object} [options.fsImpl=fsPromises]
 * @param {number} [options.chunkBytes=DEFAULT_LOG_CHUNK_BYTES]
 * @param {number} [options.overlapBytes=LOG_CHUNK_OVERLAP_BYTES]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<any|null>} The first non-nullish result, or null
 */
export async function scanLogChunks(logPath, onChunk, { fsImpl = fsPromises, chunkBytes = DEFAULT_LOG_CHUNK_BYTES, overlapBytes = LOG_CHUNK_OVERLAP_BYTES, verbose = false } = {}) {
  if (!logPath || typeof onChunk !== 'function') return null;
  const step = toPositiveInt(chunkBytes, DEFAULT_LOG_CHUNK_BYTES);
  const overlap = Math.min(toPositiveInt(overlapBytes, LOG_CHUNK_OVERLAP_BYTES), step - 1);
  let handle = null;
  try {
    const { size } = await fsImpl.stat(logPath);
    if (!size) return null;
    handle = await fsImpl.open(logPath, 'r');
    const buffer = Buffer.alloc(step);
    let position = 0;
    let carry = '';
    let chunks = 0;
    while (position < size) {
      const { bytesRead } = await handle.read(buffer, 0, step, position);
      if (!bytesRead) break;
      const text = carry + buffer.subarray(0, bytesRead).toString('utf8');
      chunks += 1;
      const isLast = position + bytesRead >= size;
      const result = onChunk(text, { offset: position, isFirst: position === 0, isLast });
      if (result !== undefined && result !== null) {
        if (verbose) console.log(`[VERBOSE] log-bounded-read: ${logPath} answered after ${chunks} chunk(s)`);
        return result;
      }
      carry = text.slice(Math.max(0, text.length - overlap));
      position += bytesRead;
    }
    if (verbose) console.log(`[VERBOSE] log-bounded-read: scanned all ${chunks} chunk(s) of ${logPath} with no match`);
    return null;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] log-bounded-read: could not scan ${logPath}: ${error?.message || error}`);
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Collect the lines of a log that match `pattern`, never accumulating more than
 * `maxBytes` of them. Used for marker-style parsing (`📊 [DISK] …`) where the
 * interesting content is a handful of lines scattered through a huge file.
 *
 * @param {string} logPath
 * @param {RegExp} pattern - Tested per line (a global regex is reset per test)
 * @param {object} [options]
 * @param {object} [options.fsImpl=fsPromises]
 * @param {number} [options.maxBytes=65536] - Ceiling on collected text
 * @param {number} [options.chunkBytes=DEFAULT_LOG_CHUNK_BYTES]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<string>} Matching lines joined by newlines
 */
export async function collectLogLinesMatching(logPath, pattern, { fsImpl = fsPromises, maxBytes = 65536, chunkBytes = DEFAULT_LOG_CHUNK_BYTES, verbose = false } = {}) {
  if (!logPath || !(pattern instanceof RegExp)) return '';
  const limit = toPositiveInt(maxBytes, 65536);
  const collected = [];
  let collectedBytes = 0;
  let residual = '';
  await scanLogChunks(
    logPath,
    (text, { isLast }) => {
      // `overlapBytes: 0` below means chunks never repeat content, so the only
      // state to carry forward is the trailing partial line.
      const source = residual ? residual + text : text;
      const lines = source.split('\n');
      residual = isLast ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        pattern.lastIndex = 0;
        if (!pattern.test(line)) continue;
        if (collectedBytes + line.length > limit) continue;
        collected.push(line);
        collectedBytes += line.length + 1;
      }
      return undefined;
    },
    { fsImpl, chunkBytes, overlapBytes: 0, verbose }
  );
  if (residual) {
    pattern.lastIndex = 0;
    if (pattern.test(residual) && collectedBytes + residual.length <= limit) collected.push(residual);
  }
  return collected.join('\n');
}

/**
 * Whole-log scan that keeps an injectable whole-file reader working.
 *
 * Several call sites accept a `readFile` for tests that hand them a synthetic
 * transcript for a path that does not exist on disk. This helper preserves that
 * contract — the injected reader is used when the path cannot be stat'ed or is
 * small enough to be harmless — while a real, large log is streamed chunk by
 * chunk and never materialised.
 *
 * @param {string} logPath
 * @param {Function} onText - `(text, {isFirst, isLast, offset}) => any`; first non-nullish result wins
 * @param {object} [options]
 * @param {object} [options.fsImpl=fsPromises]
 * @param {Function} [options.readFile] - Injectable whole-file reader for small/synthetic logs
 * @param {number} [options.chunkBytes=DEFAULT_LOG_CHUNK_BYTES]
 * @param {number} [options.overlapBytes=LOG_CHUNK_OVERLAP_BYTES]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<any|null>}
 */
export async function scanLogTextChunks(logPath, onText, { fsImpl = fsPromises, readFile = null, chunkBytes = DEFAULT_LOG_CHUNK_BYTES, overlapBytes = LOG_CHUNK_OVERLAP_BYTES, verbose = false } = {}) {
  if (!logPath || typeof onText !== 'function') return null;
  const step = toPositiveInt(chunkBytes, DEFAULT_LOG_CHUNK_BYTES);
  let size = null;
  try {
    size = (await fsImpl.stat(logPath)).size;
  } catch {
    // Not on disk (or not readable): fall through to the injected reader.
  }
  if (size === null || size <= step) {
    const read = readFile || fsImpl.readFile.bind(fsImpl);
    try {
      const text = String(await read(logPath, 'utf8'));
      const result = onText(text, { offset: 0, isFirst: true, isLast: true });
      return result === undefined ? null : result;
    } catch (error) {
      if (verbose) console.log(`[VERBOSE] log-bounded-read: could not read ${logPath}: ${error?.message || error}`);
      return null;
    }
  }
  return scanLogChunks(logPath, onText, { fsImpl, chunkBytes: step, overlapBytes, verbose });
}

/**
 * Marker-line collection that keeps an injectable whole-file reader working.
 *
 * Same contract as {@link scanLogTextChunks}, for the `📊 [DISK]`-style parsers
 * that only ever look at individual matching lines: a real log is scanned in
 * chunks and only the matching lines are kept, so a 134 MB transcript costs one
 * chunk plus a few kilobytes of results.
 *
 * @param {string} logPath
 * @param {RegExp} pattern
 * @param {object} [options] - As {@link collectLogLinesMatching}, plus `readFile`
 * @returns {Promise<string>}
 */
export async function readLogMarkerLines(logPath, pattern, { fsImpl = fsPromises, readFile = null, maxBytes = 65536, chunkBytes = DEFAULT_LOG_CHUNK_BYTES, verbose = false } = {}) {
  if (!logPath || !(pattern instanceof RegExp)) return '';
  let statable = true;
  try {
    await fsImpl.stat(logPath);
  } catch {
    statable = false;
  }
  if (statable) return collectLogLinesMatching(logPath, pattern, { fsImpl, maxBytes, chunkBytes, verbose });
  const read = readFile || fsImpl.readFile.bind(fsImpl);
  try {
    const text = String(await read(logPath, 'utf8'));
    const limit = toPositiveInt(maxBytes, 65536);
    const collected = [];
    let collectedBytes = 0;
    for (const line of text.split('\n')) {
      pattern.lastIndex = 0;
      if (!pattern.test(line)) continue;
      if (collectedBytes + line.length > limit) continue;
      collected.push(line);
      collectedBytes += line.length + 1;
    }
    return collected.join('\n');
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] log-bounded-read: could not read ${logPath}: ${error?.message || error}`);
    return '';
  }
}

/**
 * Stream a record-per-line file, one line at a time.
 *
 * `fs.readFile(file, 'utf8').split('\n')` costs *two* full copies of the file
 * (the string and the array of its lines) before the first record is looked at.
 * Claude/Codex session transcripts are JSONL that grows with the session, so
 * that shape scales with how long the AI ran — the exact class of unbounded
 * buffering issue #2189 removes.
 *
 * The line terminator is stripped, as with `split('\n')`; `\r\n` is treated as
 * one terminator. `onLine` may return `false` to stop early. Missing/unreadable
 * files rethrow, so callers keep their existing error handling.
 *
 * @param {string} logPath
 * @param {Function} onLine - `(line, index) => void|false|Promise<void|false>`
 * @param {object} [options]
 * @param {Function} [options.createReadStream=fs.createReadStream]
 * @param {number} [options.highWaterMark=DEFAULT_LOG_CHUNK_BYTES]
 * @returns {Promise<number>} Number of lines visited
 */
export async function forEachLogLine(logPath, onLine, { createReadStream = fsCreateReadStream, highWaterMark = DEFAULT_LOG_CHUNK_BYTES } = {}) {
  const stream = createReadStream(logPath, { highWaterMark });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of reader) {
      const proceed = await onLine(line, index);
      index += 1;
      if (proceed === false) break;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return index;
}

/**
 * True when `filePath` ends with a newline.
 *
 * A rewriter that streams lines has to restore the file's original trailing
 * newline explicitly: unlike `split('\n')`, a line reader does not report the
 * empty final element that a trailing terminator produces.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {object} [options.fsImpl=fsPromises]
 * @returns {Promise<boolean>}
 */
export async function fileEndsWithNewline(filePath, { fsImpl = fsPromises } = {}) {
  try {
    const { size } = await fsImpl.stat(filePath);
    if (!size) return false;
    const text = await readRangeText(fsImpl, filePath, size - 1, 1);
    return text === '\n' || text === '\r';
  } catch {
    return false;
  }
}
