#!/usr/bin/env node

/**
 * Measure a runaway session log (issue #2135).
 *
 * The log this case study is about is 286 MB, which is too large to commit, so
 * the numbers quoted in ../README.md are produced here instead: run the script
 * against the raw log and it prints (and optionally writes) the same metrics.
 *
 *   node docs/case-studies/issue-2135/scripts/measure-session-log.mjs \
 *     /path/to/full.log --json docs/case-studies/issue-2135/raw/log-metrics.json
 *
 * What it counts, and why each number matters:
 *
 *   - bytes / lines: the size that ended the session in a V8 heap abort.
 *   - nesting: a log line copied into a diff gains a leading `+`, and a diff
 *     copied into the next diff gains another. The depth histogram is the
 *     amplification loop made visible: depth 1 is "this log was committed and
 *     showed up in a diff", depth 2 is "a diff containing this log was itself
 *     committed and diffed", and so on.
 *   - diff dumps: consecutive `diff --git` sections with their byte size, i.e.
 *     each full `gh pr diff` answer that was mirrored into the log.
 *   - the fatal ending, quoted from the log itself.
 *
 * Reading is streamed line by line: the whole point of the issue is that this
 * file does not fit comfortably in a Node heap.
 *
 * @module measure-session-log
 */

import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const NESTING = /^(\++)/;
const DIFF_HEADER = /^\++?diff --git /;
const FATAL_MARKERS = ['FATAL ERROR: Reached heap limit', 'Reached heap limit Allocation failed', 'exited with code null', 'Work session failed'];

// A gap this long (in lines) between `diff --git` headers means the previous
// dump ended and a later one began, rather than one dump listing many files.
const DUMP_GAP_LINES = 2000;

export const measureSessionLog = async logPath => {
  const { size } = await stat(logPath);
  const metrics = {
    file: logPath,
    bytes: size,
    lines: 0,
    nestingDepthLines: {},
    diffFileHeaders: 0,
    diffDumps: [],
    fatalLines: [],
    longestLineBytes: 0,
  };

  let currentDump = null;
  let lastHeaderLine = -Infinity;
  const rl = createInterface({ input: createReadStream(logPath), crlfDelay: Infinity });

  for await (const line of rl) {
    metrics.lines += 1;
    const bytes = Buffer.byteLength(line) + 1;
    if (bytes > metrics.longestLineBytes) metrics.longestLineBytes = bytes;

    const nested = NESTING.exec(line);
    if (nested) {
      const depth = nested[1].length;
      metrics.nestingDepthLines[depth] = (metrics.nestingDepthLines[depth] || 0) + 1;
    }

    if (DIFF_HEADER.test(line)) {
      metrics.diffFileHeaders += 1;
      if (!currentDump || metrics.lines - lastHeaderLine > DUMP_GAP_LINES) {
        currentDump = { startLine: metrics.lines, endLine: metrics.lines, files: 0, bytes: 0 };
        metrics.diffDumps.push(currentDump);
      }
      currentDump.files += 1;
      lastHeaderLine = metrics.lines;
    }

    if (currentDump) {
      currentDump.bytes += bytes;
      currentDump.endLine = metrics.lines;
    }

    if (FATAL_MARKERS.some(marker => line.includes(marker))) {
      metrics.fatalLines.push({ line: metrics.lines, text: line.slice(0, 200) });
    }
  }

  // A dump's byte count above includes everything up to the next dump; trim it
  // back to the lines the dump itself occupied.
  metrics.diffDumpSummary = metrics.diffDumps.map(dump => ({ startLine: dump.startLine, endLine: dump.endLine, files: dump.files, bytes: dump.bytes }));
  delete metrics.diffDumps;
  return metrics;
};

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\/(?=docs\/)/, ''));
if (isMain || process.argv[1]?.endsWith('measure-session-log.mjs')) {
  const [logPath, ...rest] = process.argv.slice(2);
  if (!logPath) {
    console.error('usage: measure-session-log.mjs <log-file> [--json <out.json>]');
    process.exit(2);
  }
  const metrics = await measureSessionLog(logPath);
  const jsonIndex = rest.indexOf('--json');
  if (jsonIndex !== -1 && rest[jsonIndex + 1]) {
    await writeFile(rest[jsonIndex + 1], `${JSON.stringify(metrics, null, 2)}\n`);
  }
  console.log(JSON.stringify(metrics, null, 2));
}
