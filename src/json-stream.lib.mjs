#!/usr/bin/env node

/**
 * Incremental JSON record scanner for agentic CLI output streams.
 *
 * Issue #2119: the agent stream readers split the raw output on newlines and
 * called `JSON.parse` on each line. That works only when the tool emits strict
 * NDJSON on line boundaries that happen to align with process chunk
 * boundaries. Three real-world stream shapes break it:
 *
 *   1. Pretty-printed records — `formal-ai with agent --verbose` emits
 *      multi-line, indented JSON, so *every* line fails to parse. Every
 *      structured event (session id, token usage, errors, result text) is then
 *      dropped, which is how a run with 21677 input / 22834 output tokens was
 *      published as "Token usage: 0 input, 0 output".
 *   2. Concatenated records — `{...}{...}` arriving without a separator
 *      (issue #1250).
 *   3. Split records — one record spanning two process chunks.
 *
 * Scanning for balanced JSON values instead of relying on line framing handles
 * all three with a single mechanism, and non-JSON output is still surfaced
 * verbatim as text events so plain tool logs keep flowing.
 */

// A pending fragment that never balances (for example prose that happens to
// start with `{`) must not grow without bound. Once the buffer exceeds this
// size it is released as text.
export const DEFAULT_MAX_PENDING_BYTES = 4 * 1024 * 1024;

const isStructuralOpener = character => character === '{' || character === '[';

/**
 * Find the index just past the JSON value starting at `start`.
 * @returns {number} end index (exclusive), or -1 when the value is incomplete.
 */
const findValueEnd = (buffer, start) => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < buffer.length; index++) {
    const character = buffer[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      depth++;
      continue;
    }
    if (character === '}' || character === ']') {
      depth--;
      if (depth === 0) return index + 1;
      if (depth < 0) return -1;
    }
  }

  return -1;
};

/**
 * Create a stateful scanner that turns a byte stream into JSON and text events.
 *
 * @param {Object} [options]
 * @param {number} [options.maxPendingBytes] release an unbalanced buffer once it grows past this size
 * @returns {{write: (chunk: string) => Array<Object>, flush: () => Array<Object>}}
 */
export const createJsonStreamScanner = (options = {}) => {
  const maxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;
  let pending = '';

  const emitTextLines = (text, events) => {
    for (const line of text.split('\n')) {
      if (line.trim()) events.push({ type: 'text', value: line });
    }
  };

  const scan = (final, events) => {
    let index = 0;

    while (index < pending.length) {
      const character = pending[index];

      if (character === '\n' || character === '\r' || character === ' ' || character === '\t') {
        index++;
        continue;
      }

      if (isStructuralOpener(character)) {
        const end = findValueEnd(pending, index);
        if (end < 0) break; // incomplete record: wait for more input
        const raw = pending.slice(index, end);
        try {
          events.push({ type: 'json', value: JSON.parse(raw), raw });
        } catch {
          // Balanced but not valid JSON: surface it verbatim rather than
          // silently dropping tool output.
          emitTextLines(raw, events);
        }
        index = end;
        continue;
      }

      const newline = pending.indexOf('\n', index);
      if (newline < 0) break; // incomplete text line: wait for more input
      const line = pending.slice(index, newline).replace(/\r$/, '');
      if (line.trim()) events.push({ type: 'text', value: line });
      index = newline + 1;
    }

    pending = pending.slice(index);

    if (final) {
      if (pending.trim()) {
        const trimmed = pending.trim();
        let parsed = null;
        if (isStructuralOpener(trimmed[0])) {
          try {
            parsed = { type: 'json', value: JSON.parse(trimmed), raw: trimmed };
          } catch {
            parsed = null;
          }
        }
        if (parsed) events.push(parsed);
        else emitTextLines(pending, events);
      }
      pending = '';
    } else if (pending.length > maxPendingBytes) {
      emitTextLines(pending, events);
      pending = '';
    }

    return events;
  };

  return {
    write(chunk) {
      pending += String(chunk ?? '');
      return scan(false, []);
    },
    flush() {
      return scan(true, []);
    },
    /** The unconsumed tail: an incomplete record or text line. */
    pending() {
      return pending;
    },
  };
};

/**
 * Split a buffered stream into complete JSON records plus the unconsumed tail.
 *
 * Stateless counterpart of `createJsonStreamScanner`, for the parsers that keep
 * their buffer inside a plain state object they hand back to their caller
 * (`parseGeminiJsonOutput`, `parseQwenStreamJsonOutput`) instead of holding a
 * closure across chunks.
 *
 * @param {string} buffered carried-over tail followed by the new chunk
 * @returns {{records: Array<Object>, rest: string}}
 */
export const takeJsonRecords = buffered => {
  const scanner = createJsonStreamScanner();
  const events = scanner.write(String(buffered ?? ''));
  return {
    records: events.filter(event => event.type === 'json').map(event => event.value),
    rest: scanner.pending(),
  };
};

/**
 * Buffer a byte stream into whole lines.
 *
 * Line-oriented parsers (Codex NDJSON plus its interleaved OTEL diagnostics)
 * stay correct as long as they never see half a line. A process chunk boundary
 * can fall anywhere, so the trailing partial line is carried over to the next
 * chunk and released by `flush()`.
 *
 * @returns {{write: (chunk: string) => string, flush: () => string}}
 */
export const createLineBuffer = () => {
  let pending = '';

  return {
    write(chunk) {
      pending += String(chunk ?? '');
      const boundary = pending.lastIndexOf('\n');
      if (boundary < 0) return '';
      const complete = pending.slice(0, boundary + 1);
      pending = pending.slice(boundary + 1);
      return complete;
    },
    flush() {
      const rest = pending;
      pending = '';
      return rest;
    },
  };
};

/**
 * Extract every complete JSON record from a finished output buffer.
 *
 * @param {string} output raw tool output
 * @returns {Array<Object>} parsed JSON values in stream order
 */
export const parseJsonRecords = output => {
  const scanner = createJsonStreamScanner();
  const events = [...scanner.write(String(output ?? '')), ...scanner.flush()];
  return events.filter(event => event.type === 'json').map(event => event.value);
};
