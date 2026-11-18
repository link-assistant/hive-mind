/**
 * Issue #2293: what of Codex's stderr goes into the solve log.
 *
 * Under `--verbose` Codex runs with `RUST_LOG=debug`, because its compaction
 * and token diagnostics exist only as debug lines (codex.diagnostics.lib.mjs
 * reads them from the stream). Mirroring all of that stderr into the solve log
 * made a third of it debug output: 45,016 of 135,525 lines in the
 * link-foundation/meta-language#196 log, an OpenTelemetry heartbeat every
 * minute for six hours, and 1,187 copies of one plugin manifest warning.
 *
 * TRACE/DEBUG/INFO tracing lines now go to a file next to the log. WARN and
 * ERROR lines stay, each distinct one once, with the number of repeats at the
 * end. An error Codex prints before it exits is always kept. Issue #4079: a
 * line without a tracing prefix continues the record before it and goes where
 * that record went (see createCodexStderrLog).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2293
 */

import { appendFileSync } from 'node:fs';
import { createLineBuffer } from './json-stream.lib.mjs';
import { redactTelemetryIdentity } from './telemetry-identity-redaction.lib.mjs'; // Issue #4079

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const TRACING_LINE = /^\S*?(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s/;
const KEPT_LEVELS = new Set(['WARN', 'ERROR']);

/**
 * @param {string} line
 * @returns {string|null} the tracing level, or null for any other line
 */
export const classifyCodexStderrLine = line =>
  String(line ?? '')
    .replace(ANSI, '')
    .match(TRACING_LINE)?.[2] ?? null;

/** The tracing file for a solve log: `solve.log` → `solve.codex-trace.log`. */
export const codexTracePathFor = logFile => (logFile ? `${String(logFile).replace(/\.log$/, '')}.codex-trace.log` : null);

// Lines Codex prints itself, outside any tracing record, that must never be
// hidden in the trace file (findCodexStderrError reads the same shapes).
const ALWAYS_KEPT = /^\s*(?:error|fatal|panic|warning)\b|^thread '.*' panicked/i;

/**
 * Issue #4079: collapses runs of one line into the line once and a count.
 * @param {(line: string) => string} describe - the line that stands for `count` dropped repeats
 */
const createRepeatCollapser = describe => {
  let last = null;
  let repeats = 0;
  const closeRun = () => {
    const out = repeats ? [describe(repeats)] : [];
    repeats = 0;
    return out;
  };
  return {
    /** @returns {string[]} what to emit for this line */
    push: line => {
      if (line === last) {
        repeats++;
        return [];
      }
      const out = closeRun();
      last = line;
      out.push(line);
      return out;
    },
    flush: () => {
      const out = closeRun();
      last = null;
      return out;
    },
  };
};

const repeatedMore = count => `repeated ${count} more time${count === 1 ? '' : 's'}`;

/**
 * Issue #4079: a tracing record can span many lines. Codex's
 * `codex.tool_result` INFO record carries the tool call's arguments verbatim,
 * so its continuation lines have no tracing prefix; they used to be kept as
 * "not a tracing line", which put 63,437 lines of a degenerate tool call and
 * 3,964 copies of the account's email address into one published log. A
 * continuation line now goes where its record went, runs of one line are
 * collapsed into a count, and account identifiers are redacted everywhere.
 *
 * @param {Object} [options]
 * @param {string|null} [options.tracePath] - where TRACE/DEBUG/INFO lines go; without it they are only counted
 * @param {Function} [options.append] - `appendFileSync`, injectable for tests
 * @returns {{write: (chunk: string) => string[], end: () => string[]}} each returns the lines to log
 */
export const createCodexStderrLog = ({ tracePath = null, append = appendFileSync } = {}) => {
  const buffer = createLineBuffer();
  const seen = new Map();
  const keptRuns = createRepeatCollapser(count => `ℹ️  Codex stderr: previous line ${repeatedMore(count)}`);
  const traceRuns = createRepeatCollapser(count => `… previous line ${repeatedMore(count)}`);
  let traced = 0;
  let traceError = null;
  // Where the current record went: 'trace', 'keep', or 'drop' (a repeated warning).
  let record = 'keep';

  const writeTrace = lines => {
    if (!lines.length || !tracePath || traceError) return;
    try {
      append(tracePath, `${lines.join('\n')}\n`);
    } catch (error) {
      traceError = error.message;
    }
  };

  const route = (text, final = false) => {
    const kept = [];
    const trace = [];
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      const line = redactTelemetryIdentity(raw);
      const level = classifyCodexStderrLine(line);
      let destination;
      if (level && !KEPT_LEVELS.has(level)) destination = 'trace';
      else if (level) {
        const key = line.replace(ANSI, '').replace(TRACING_LINE, '$2 ').trim();
        seen.set(key, (seen.get(key) ?? 0) + 1);
        destination = seen.get(key) > 1 ? 'drop' : 'keep';
      } else if (ALWAYS_KEPT.test(line.replace(ANSI, ''))) {
        kept.push(...keptRuns.push(line));
        continue;
      } else destination = record;
      if (level) record = destination;
      if (destination === 'trace') {
        traced++;
        trace.push(...traceRuns.push(line));
      } else if (destination === 'keep') kept.push(...keptRuns.push(line));
    }
    if (final) {
      trace.push(...traceRuns.flush());
      kept.push(...keptRuns.flush());
    }
    writeTrace(trace);
    return kept;
  };

  return {
    write: chunk => route(buffer.write(chunk)),
    end: () => {
      const kept = route(buffer.flush(), true);
      const where = tracePath && !traceError ? `written to ${tracePath}` : `left out of this log${traceError ? ` (${tracePath}: ${traceError})` : ''}`;
      if (traced) kept.push(`ℹ️  Codex stderr: ${traced} TRACE/DEBUG/INFO line${traced === 1 ? '' : 's'} ${where}`);
      for (const [line, count] of seen) if (count > 1) kept.push(`ℹ️  Codex stderr: ${repeatedMore(count - 1)}: ${line.length > 200 ? `${line.slice(0, 200)}…` : line}`);
      return kept;
    },
  };
};

export default { classifyCodexStderrLine, codexTracePathFor, createCodexStderrLog };
