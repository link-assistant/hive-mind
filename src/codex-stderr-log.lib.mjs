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
 * end. A line that is not a tracing line (an error Codex prints before it
 * exits) is always kept.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2293
 */

import { appendFileSync } from 'node:fs';
import { createLineBuffer } from './json-stream.lib.mjs';

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

/**
 * @param {Object} [options]
 * @param {string|null} [options.tracePath] - where TRACE/DEBUG/INFO lines go; without it they are only counted
 * @param {Function} [options.append] - `appendFileSync`, injectable for tests
 * @returns {{write: (chunk: string) => string[], end: () => string[]}} each returns the lines to log
 */
export const createCodexStderrLog = ({ tracePath = null, append = appendFileSync } = {}) => {
  const buffer = createLineBuffer();
  const seen = new Map();
  let traced = 0;
  let traceError = null;

  const route = text => {
    const kept = [];
    const trace = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const level = classifyCodexStderrLine(line);
      if (level && !KEPT_LEVELS.has(level)) {
        trace.push(line);
        continue;
      }
      if (level) {
        const key = line.replace(ANSI, '').replace(TRACING_LINE, '$2 ').trim();
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (seen.get(key) > 1) continue;
      }
      kept.push(line);
    }
    traced += trace.length;
    if (trace.length && tracePath && !traceError) {
      try {
        append(tracePath, `${trace.join('\n')}\n`);
      } catch (error) {
        traceError = error.message;
      }
    }
    return kept;
  };

  return {
    write: chunk => route(buffer.write(chunk)),
    end: () => {
      const kept = route(buffer.flush());
      const where = tracePath && !traceError ? `written to ${tracePath}` : `left out of this log${traceError ? ` (${tracePath}: ${traceError})` : ''}`;
      if (traced) kept.push(`ℹ️  Codex stderr: ${traced} TRACE/DEBUG/INFO line${traced === 1 ? '' : 's'} ${where}`);
      for (const [line, count] of seen) if (count > 1) kept.push(`ℹ️  Codex stderr: repeated ${count - 1} more time${count === 2 ? '' : 's'}: ${line.length > 200 ? `${line.slice(0, 200)}…` : line}`);
      return kept;
    },
  };
};

export default { classifyCodexStderrLine, codexTracePathFor, createCodexStderrLog };
