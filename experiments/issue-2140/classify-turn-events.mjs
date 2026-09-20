#!/usr/bin/env node
// Issue #2140 — where did the three `turn.started` lines come from?
//
// The captured run log (docs/case-studies/issue-2140/raw/solve-run-issue-905.log.txt.gz)
// records both of the Codex child's streams with the same `[INFO]` tag, because
// `log(chunk, { stream: 'stderr' })` silently drops the `stream` option (see
// src/lib.mjs). So provenance has to be recovered structurally.
//
// The recovery rule used here relies on how the log is written: `log()` prefixes
// **every line of one message** with the *same* timestamp (issue #1572), and each
// stdout/stderr chunk from the Codex child is logged with exactly one `log()`
// call. Lines that share a timestamp therefore came from one chunk — i.e. from a
// single stream. A group that contains a `codex_otel…` tracing record is stderr
// (that is where Codex writes RUST_LOG/OTEL output); a group made only of NDJSON
// is the `--json` protocol on stdout.
//
// Usage: node experiments/issue-2140/classify-turn-events.mjs [path-to-log(.gz)]

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultLog = path.join(here, '../../docs/case-studies/issue-2140/raw/solve-run-issue-905.log.txt.gz');
const logPath = process.argv[2] || defaultLog;

const readLog = file => {
  const buffer = fs.readFileSync(file);
  return (file.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer).toString('utf8');
};

const LOG_PREFIX = /^\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\] \[[A-Z]+\] ?/;
const OTEL_MARKER = /^\d{4}-\d\d-\d\dT[\d:.]+Z\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s/;
const TOOL_RESULT_MARKER = /codex_otel\.(log_only|trace_safe): event\.name="codex\.tool_result"/;

/** Group consecutive log lines that share one timestamp — i.e. one `log()` call. */
export const groupLogChunks = text => {
  const groups = [];
  let current = null;
  text.split('\n').forEach((rawLine, index) => {
    const match = LOG_PREFIX.exec(rawLine);
    if (!match) return;
    const timestamp = match[1];
    const body = rawLine.slice(match[0].length);
    if (!current || current.timestamp !== timestamp) {
      current = { timestamp, startLine: index + 1, lines: [] };
      groups.push(current);
    }
    current.lines.push({ lineNumber: index + 1, body });
  });
  return groups;
};

/** stderr ⇔ the chunk carries Codex's OTEL/RUST_LOG tracing text. */
export const classifyChunk = group => (group.lines.some(({ body }) => OTEL_MARKER.test(body)) ? 'stderr' : 'stdout');

const isProtocolShaped = body => {
  if (!body.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' && typeof parsed.type === 'string';
  } catch {
    return false;
  }
};

const main = () => {
  const text = readLog(logPath);
  const groups = groupLogChunks(text);

  const interesting = [];
  for (const group of groups) {
    const source = classifyChunk(group);
    const hasToolResultDump = group.lines.some(({ body }) => TOOL_RESULT_MARKER.test(body));
    for (const { lineNumber, body } of group.lines) {
      if (!isProtocolShaped(body)) continue;
      const event = JSON.parse(body);
      if (!/^(turn\.|thread\.)/.test(event.type)) continue;
      interesting.push({
        lineNumber,
        source,
        hasToolResultDump,
        type: event.type,
        threadId: event.thread_id || null,
        chunkStart: group.startLine,
        timestamp: group.timestamp,
      });
    }
  }

  console.log(`log: ${path.relative(path.join(here, '../..'), logPath)}`);
  console.log(`log lines: ${text.split('\n').length}, logged chunks: ${groups.length}`);
  console.log('');
  console.log('line     stream  in-tool_result-dump  type            thread_id');
  for (const row of interesting) {
    console.log(`${String(row.lineNumber).padEnd(8)} ${row.source.padEnd(7)} ${String(row.hasToolResultDump).padEnd(20)} ${row.type.padEnd(15)} ${row.threadId || ''}`);
  }

  const tally = {};
  for (const row of interesting) {
    const key = `${row.type}@${row.source}`;
    tally[key] = (tally[key] || 0) + 1;
  }
  console.log('');
  console.log('tally:', tally);
  return interesting;
};

if (import.meta.url === `file://${process.argv[1]}`) main();
