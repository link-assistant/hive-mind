#!/usr/bin/env node
/**
 * Extract the case-study artifacts for issue #2189 from the raw incident log.
 *
 * The raw log is 140 MB and comes from a PRIVATE repository; it is deliberately
 * NOT committed. This script produces the bounded, sanitized excerpts and the
 * derived statistics that ARE committed under
 * `docs/case-studies/issue-2189/`, using Hive Mind's own bounded-read and
 * streaming-sanitize helpers (dogfooding the fix).
 *
 * Usage:
 *   node experiments/issue-2189-extract-case-data.mjs /tmp/case2189/full.log
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';

const source = process.argv[2] || '/tmp/case2189/full.log';
const outDir = process.argv[3] || path.join(process.cwd(), 'docs', 'case-studies', 'issue-2189', 'logs');
const HEAD_LINES = 260;
const TAIL_LINES = 320;

await fs.mkdir(outDir, { recursive: true });
const stats = await fs.stat(source);

// Single streaming pass: head, tail ring buffer, resource markers, timeline,
// line/byte statistics and 40-hex-token counts. Nothing is held whole.
const head = [];
const tail = [];
const markers = [];
const timeline = [];
const shape = { bytes: stats.size, lines: 0, longestLine: 0, emptyLines: 0, hex40Standalone: 0, hex40Lines: 0, sanitizedNotices: [], carriageLines: 0 };
const TIMELINE_PATTERNS = [/^=== Start Command Log ===/, /^(?:Execution ID|Timestamp|Command|Mode|Session|Image|Platform|Node Version|Container ID|Live log):/, /^🚀 solve v/, /^📥 Cloning repository/, /^🚀 Starting work session/, /^📝 (?:Final Codex message|Codex file change items|Captured result summary|Converting PR)/, /^✅ No uncommitted changes found/, /is marked as "ready for review"/, /^✅ PR converted/, /^📎 Uploading solution draft log/, /Large log file \(/, /Sanitizing log content to mask/, /Sanitized \d+ secrets/, /Escaping code blocks in log content/, /too large for inline comment/, /Uploading log using gh-upload-log/, /Repository visibility:/, /<--- Last few GCs --->/, /^\[1:0x[0-9a-f]+\] \d+ ms: Mark-Compact/, /^FATAL ERROR:/, /Runtime_RegExpExecMultiple/, /^Container kept for investigation/, /^Reason: exitCode=/, /^Finished:/, /^Exit Code:/, /📈 \[RESOURCES\]/];
const ISO_TIMESTAMP = /\b(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?)\b/;
const HEX40 = /(?:^|[\s:=])([a-f0-9]{40})(?=[\s\n]|$)/g;
let latestTimestampMs = 0;
let latestTimestamp = null;
// The log embeds the agent's own file contents, which contain unrelated dates
// (fixtures dated 2099, changelogs dated 2024). Only timestamps inside the run
// window may advance the clock.
let runStartMs = 0;
const RUN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const rl = readline.createInterface({ input: createReadStream(source, { encoding: 'utf8' }), crlfDelay: Infinity });
for await (const line of rl) {
  shape.lines += 1;
  if (line.length > shape.longestLine) shape.longestLine = line.length;
  if (line.trim() === '') shape.emptyLines += 1;
  if (line.includes('\r')) shape.carriageLines += 1;
  if (head.length < HEAD_LINES) head.push(line);
  tail.push(line);
  if (tail.length > TAIL_LINES) tail.shift();
  if (line.includes('📈 [RESOURCES]')) markers.push(`${shape.lines}: ${line}`);
  if (/Sanitized \d+ secrets/.test(line)) shape.sanitizedNotices.push(`${shape.lines}: ${line.trim()}`);
  HEX40.lastIndex = 0;
  let m;
  let lineHits = 0;
  while ((m = HEX40.exec(line)) !== null) lineHits += 1;
  if (lineHits > 0) {
    shape.hex40Standalone += lineHits;
    shape.hex40Lines += 1;
  }
  // The log carries ISO timestamps only inside the agent's own JSON events, so
  // milestone lines are dated by the most recent timestamp seen before them.
  if (!runStartMs) {
    const header = /^Timestamp: (20\d\d-\d\d-\d\d) (\d\d:\d\d:\d\d)/.exec(line);
    if (header) runStartMs = Date.parse(`${header[1]}T${header[2]}Z`) || 0;
  }
  const stamp = ISO_TIMESTAMP.exec(line);
  if (stamp) {
    const parsed = Date.parse(stamp[1].endsWith('Z') ? stamp[1] : `${stamp[1]}Z`);
    const inRunWindow = !runStartMs || (parsed >= runStartMs - RUN_WINDOW_MS && parsed <= runStartMs + RUN_WINDOW_MS);
    if (Number.isFinite(parsed) && inRunWindow && parsed > latestTimestampMs) {
      latestTimestampMs = parsed;
      latestTimestamp = stamp[1];
    }
  }
  if (TIMELINE_PATTERNS.some(pattern => pattern.test(line))) timeline.push(`line ${String(shape.lines).padStart(6, ' ')} [t <= ${latestTimestamp || 'no timestamp yet'}] ${line.trim().slice(0, 400)}`);
}

const writeSanitized = async (name, text) => {
  const raw = path.join('/tmp', `issue-2189-${name}.raw`);
  await fs.writeFile(raw, text, 'utf8');
  const dest = path.join(outDir, name);
  await fs.rm(dest, { force: true });
  const result = await sanitizeLogFileToFile({ sourcePath: raw, destPath: dest });
  await fs.chmod(dest, 0o644);
  await fs.rm(raw, { force: true });
  return result;
};

const headResult = await writeSanitized('incident-head.log.txt', `${head.join('\n')}\n`);
const tailResult = await writeSanitized('incident-tail.log.txt', `${tail.join('\n')}\n`);
const markerResult = await writeSanitized('incident-resource-markers.txt', `${markers.join('\n')}\n`);
const timelineResult = await writeSanitized('incident-timeline.txt', `${timeline.join('\n')}\n`);

const shapeText = ['# Shape of the incident log (issue #2189)', '', `source bytes:            ${shape.bytes}`, `source megabytes:        ${(shape.bytes / 1024 / 1024).toFixed(1)} MB`, `lines:                   ${shape.lines}`, `blank lines:             ${shape.emptyLines}`, `longest line (chars):    ${shape.longestLine}`, `lines containing CR:     ${shape.carriageLines}`, `standalone 40-hex hits:  ${shape.hex40Standalone} on ${shape.hex40Lines} lines`, '', '"Sanitized N secrets" notices (one per full sanitize pass over the log):', ...shape.sanitizedNotices.map(l => `  ${l}`), '', `resource markers found:  ${markers.length}`, ...markers.map(l => `  ${l.slice(0, 200)}`), ''].join('\n');
await fs.writeFile(path.join(outDir, 'incident-log-shape.txt'), shapeText, 'utf8');

console.log(JSON.stringify({ shape: { ...shape, sanitizedNotices: shape.sanitizedNotices.length }, headResult, tailResult, markerResult, timelineResult, markers: markers.length, timeline: timeline.length }, null, 2));
