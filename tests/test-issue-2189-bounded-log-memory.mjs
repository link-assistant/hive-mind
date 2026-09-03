#!/usr/bin/env node

/**
 * Regression: nothing on the log-publication path may buffer a whole log.
 *
 * Incident (issue #2189): a `/solve` run finished successfully, `--attach-logs`
 * then read its **134 MB** transcript into a single string, sanitized it,
 * escaped it, and sanitized it again — for a comment GitHub could never have
 * accepted. The run died with
 *
 *   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 *
 * and was reported to the operator as a "forced kill — memory (10.3 GB of
 * 11.7 GB RAM available)", because a V8 self-abort is invisible to
 * `docker inspect` (`OOMKilled=false`) and to cgroup OOM counters (`oom_kill 0`).
 *
 * This file locks in the three fixes:
 *   1. `sanitizeLogFileToFile` sanitizes block by block, byte-identically to a
 *      whole-file pass, with bounded residency and no partial output on failure.
 *   2. `readLogTextBounded` / `scanLogChunks` / `collectLogLinesMatching` answer
 *      questions about a log without ever holding it.
 *   3. `findFatalMemoryMarker` / `describeKillCause` classify a runtime
 *      self-abort as out-of-memory from the log text alone.
 *   4. `attachLogToGitHub` picks the upload route from `logStats.size` BEFORE
 *      reading anything, and sanitizes exactly once.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { promises as fs, constants as fsConstants } from 'node:fs';
import fsMod from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { computeReleaseBoundary, sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';
import { LOG_TRUNCATION_MARKER, collectLogLinesMatching, readLogHeadText, readLogTailText, readLogTextBounded, scanLogChunks } from '../src/log-bounded-read.lib.mjs';
import { findFatalMemoryMarker } from '../src/child-exit.lib.mjs';
import { KILL_CAUSE_FORCED_KILL, KILL_CAUSE_OUT_OF_MEMORY, buildKillDiagnosticsSection, describeKillCause } from '../src/session-kill-diagnostics.lib.mjs';
import { attachLogToGitHub, formatLogSizeForHumans } from '../src/github.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-2189-'));
const tmp = name => path.join(workDir, name);

const FATAL_V8_LINE = 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory';

console.log('================================================================================');
console.log('Regression: bounded-memory log handling and V8 heap-OOM classification (#2189)');
console.log('================================================================================\n');

// ---------------------------------------------------------------------------
// 1. Streaming sanitize == whole-file sanitize
// ---------------------------------------------------------------------------
console.log('1. Streaming sanitize equivalence and bounds\n');

const PEM_BLOCK = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEAx7Xn3Qd8xkq0Zk1Yy3Yh5c9wKq2r0lVn8yQ3mB1s6cT4uW9v', 'Zk1Yy3Yh5c9wKq2r0lVn8yQ3mB1s6cT4uW9vMIIEowIBAAKCAQEAx7Xn3Qd8xkq0', '-----END RSA PRIVATE KEY-----'].join('\n');

const buildCorpus = () => {
  const lines = [];
  for (let i = 0; i < 900; i++) {
    lines.push(`[2026-09-02T13:0${i % 10}:00Z] worker ${i} processing task ${i} with a reasonably long line of transcript text`);
    if (i % 120 === 17) lines.push(`  token leak ghp_${'A1b2C3d4E5'.repeat(3)}6789 in the middle of the transcript`);
    if (i % 200 === 31) lines.push(`  aws access key AKIA${'QWERTYUIOP'.repeat(1)}ASDF used by the tool`);
    if (i % 300 === 44) lines.push(PEM_BLOCK);
  }
  lines.push(FATAL_V8_LINE);
  return `${lines.join('\n')}\n`;
};

const corpus = buildCorpus();
const corpusPath = tmp('corpus.log');
await fs.writeFile(corpusPath, corpus, 'utf8');

const wholeFileSanitized = await sanitizeForPublication(corpus);

const streamedPath = tmp('corpus.sanitized.log');
const heapSamples = [];
const heapBefore = process.memoryUsage().heapUsed;
const streamStats = await sanitizeLogFileToFile({
  sourcePath: corpusPath,
  destPath: streamedPath,
  chunkBytes: 4096,
  onProgress: () => heapSamples.push(process.memoryUsage().heapUsed),
});
const streamed = await fs.readFile(streamedPath, 'utf8');

assert(streamed === wholeFileSanitized, 'block-wise sanitize is byte-identical to a whole-file sanitize (tokens and PEM blocks straddle chunk boundaries)');
assert(streamStats.blocks > 5, `the corpus was released in several blocks, not one (blocks=${streamStats.blocks})`);
assert(streamStats.forcedReleases === 0, `well-formed content never hits the hold cap (forcedReleases=${streamStats.forcedReleases})`);
assert(streamStats.sourceSize === Buffer.byteLength(corpus), 'sourceSize reports the real file size');
assert(!streamed.includes('ghp_A1b2C3d4E5'), 'the GitHub token is masked in the streamed output');
assert(!streamed.includes('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx7Xn3Qd8xkq0'), 'the PEM body is masked in the streamed output');

const peakHeapDelta = Math.max(...heapSamples) - heapBefore;
assert(peakHeapDelta < 64 * 1024 * 1024, `peak heap growth during the stream stays bounded (${Math.round(peakHeapDelta / 1024 / 1024)}MB < 64MB)`);

const destMode = (await fs.stat(streamedPath)).mode & 0o777;
assert(destMode === 0o600, `the sanitized file is created private (mode=${destMode.toString(8)})`);

// Failure must not leave a half-sanitized file behind for a caller to upload.
const failingPath = tmp('failing.sanitized.log');
let failureRaised = null;
try {
  await sanitizeLogFileToFile({
    sourcePath: corpusPath,
    destPath: failingPath,
    chunkBytes: 4096,
    sanitize: async () => {
      throw new Error('sanitizer exploded');
    },
  });
} catch (error) {
  failureRaised = error;
}
assert(failureRaised?.message === 'sanitizer exploded', 'a sanitizer failure propagates to the caller');
assert(
  await fs
    .access(failingPath, fsConstants.F_OK)
    .then(() => false)
    .catch(() => true),
  'a failed sanitize leaves no partial destination file behind'
);

// An enormous single line cannot reintroduce unbounded growth.
const noNewlinePath = tmp('one-line.log');
await fs.writeFile(noNewlinePath, `${'x'.repeat(40000)}\n${'y'.repeat(40000)}`, 'utf8');
const forcedStats = await sanitizeLogFileToFile({ sourcePath: noNewlinePath, destPath: tmp('one-line.sanitized.log'), chunkBytes: 4096, maxHoldBytes: 8192 });
assert(forcedStats.forcedReleases > 0, `a line longer than the hold cap is force-released instead of buffered (forcedReleases=${forcedStats.forcedReleases})`);

// ---------------------------------------------------------------------------
// 2. computeReleaseBoundary hold-back contract
// ---------------------------------------------------------------------------
console.log('\n2. Release-boundary hold-back contract\n');

assert(computeReleaseBoundary('a line\npartial') === 'a line\n'.length, 'a partial trailing line is held back');
assert(computeReleaseBoundary('no newline at all') === 0, 'a buffer without any record boundary releases nothing');
const heldPem = `prefix\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n`;
assert(computeReleaseBoundary(heldPem) === 'prefix\n'.length, 'an unterminated PEM block is held until its END marker arrives');
const wholePem = `prefix\n${PEM_BLOCK}\ntail\n`;
assert(computeReleaseBoundary(wholePem) >= wholePem.indexOf('-----END RSA PRIVATE KEY-----'), 'a complete PEM block is released together with its END marker');

// ---------------------------------------------------------------------------
// 3. Bounded readers
// ---------------------------------------------------------------------------
console.log('\n3. Bounded log readers\n');

const bigLines = [];
bigLines.push('HEAD-MARKER start of transcript');
for (let i = 0; i < 60000; i++) bigLines.push(`[line ${i}] 📊 [DISK] phase=step_${i % 7} used=${i}`);
bigLines.push('TAIL-MARKER end of transcript');
const bigPath = tmp('big.log');
await fs.writeFile(bigPath, `${bigLines.join('\n')}\n`, 'utf8');
const bigSize = (await fs.stat(bigPath)).size;
assert(bigSize > 2 * 1024 * 1024, `the fixture log is large enough to matter (${bigSize} bytes)`);

const bounded = await readLogTextBounded(bigPath, { maxBytes: 64 * 1024 });
assert(bounded.length <= 64 * 1024 + LOG_TRUNCATION_MARKER.length, `readLogTextBounded honours its byte budget (${bounded.length} chars)`);
assert(bounded.includes(LOG_TRUNCATION_MARKER.trim()), 'a truncated read is explicitly marked as truncated');
assert(bounded.includes('HEAD-MARKER'), 'the head of the transcript survives a bounded read');
assert(bounded.includes('TAIL-MARKER'), 'the tail of the transcript survives a bounded read');

const smallPath = tmp('small.log');
await fs.writeFile(smallPath, 'tiny log\n', 'utf8');
assert((await readLogTextBounded(smallPath, { maxBytes: 64 * 1024 })) === 'tiny log\n', 'a log below the budget is returned verbatim');
assert((await readLogTextBounded(tmp('missing.log'), { maxBytes: 1024 })) === '', 'a missing log reads as empty instead of throwing');

const head = await readLogHeadText(bigPath, { maxBytes: 4096 });
const tail = await readLogTailText(bigPath, { maxBytes: 4096 });
assert(head.length <= 4096 && head.startsWith('HEAD-MARKER'), 'readLogHeadText returns the start within budget');
assert(tail.length <= 4096 && tail.trimEnd().endsWith('TAIL-MARKER end of transcript'), 'readLogTailText returns the end within budget');

// A marker split across a chunk boundary is still found exactly once.
const straddlePath = tmp('straddle.log');
const filler = 'f'.repeat(4096 - 5);
await fs.writeFile(straddlePath, `${filler}NEEDLE-VALUE-HERE\n${'g'.repeat(9000)}\n`, 'utf8');
const found = await scanLogChunks(straddlePath, text => (text.includes('NEEDLE-VALUE-HERE') ? 'found' : null), { chunkBytes: 4096, overlapBytes: 64 });
assert(found === 'found', 'scanLogChunks finds a marker that straddles a chunk boundary');
const notFound = await scanLogChunks(bigPath, text => (text.includes('NOT-IN-THIS-LOG') ? 'found' : null), { chunkBytes: 64 * 1024 });
assert(notFound === null, 'scanLogChunks returns null after scanning a whole log with no match');

const diskLines = await collectLogLinesMatching(bigPath, /📊 \[DISK\] phase=step_3 /, { maxBytes: 8192, chunkBytes: 64 * 1024 });
assert(diskLines.length > 0 && diskLines.length <= 8192, `collectLogLinesMatching collects matching lines within its budget (${diskLines.length} chars)`);
assert(
  diskLines.split('\n').every(line => line.includes('phase=step_3')),
  'collectLogLinesMatching only returns matching lines'
);

// ---------------------------------------------------------------------------
// 4. Runtime self-abort detection
// ---------------------------------------------------------------------------
console.log('\n4. Runtime self-abort detection\n');

const v8Marker = findFatalMemoryMarker(`some log\n<--- Last few GCs --->\n${FATAL_V8_LINE}\n`);
assert(v8Marker?.runtime === 'Node.js/V8', 'a V8 fatal heap-limit abort is recognised');
assert(findFatalMemoryMarker('memory allocation of 1073741824 bytes failed')?.runtime === 'Rust', 'a Rust allocation failure is recognised');
assert(findFatalMemoryMarker('fatal error: runtime: out of memory')?.runtime === 'Go', 'a Go out-of-memory abort is recognised');
assert(findFatalMemoryMarker('terminate called after throwing an instance of std::bad_alloc')?.runtime === 'C/C++', 'a C++ bad_alloc is recognised');
assert(findFatalMemoryMarker('the tool reported it was out of memory budget for today') === null, 'prose that merely mentions memory is not a fatal marker');
assert(findFatalMemoryMarker(null) === null && findFatalMemoryMarker('') === null, 'a missing log yields no marker');

// ---------------------------------------------------------------------------
// 5. Kill classification (the incident, reproduced)
// ---------------------------------------------------------------------------
console.log('\n5. Kill classification\n');

// Exactly the incident: exit 139, docker says OOMKilled=false, cgroup says
// oom_kill=0, host memory is healthy, and the log ends with a V8 self-abort.
const healthySystem = { memory: { availableBytes: 10.3 * 1024 ** 3, totalBytes: 11.7 * 1024 ** 3 }, cgroup: { oomKill: 0 }, victims: [], pressure: null };
const incident = describeKillCause({ logText: `worker finished\n<--- Last few GCs --->\n${FATAL_V8_LINE}\n`, oomKilled: false, exitCode: 139, system: healthySystem });
assert(incident.cause === KILL_CAUSE_OUT_OF_MEMORY, `exit 139 + a V8 heap-limit abort is out-of-memory even with oomKilled=false and oom_kill=0 (got ${incident.cause})`);
assert(incident.fatalMemoryMarker?.id === 'v8-last-few-gcs' || incident.fatalMemoryMarker?.runtime === 'Node.js/V8', 'the diagnosis carries the marker it was derived from');
assert(/hit its own heap limit, not the machine's/.test(incident.summary), `the summary says which limit was hit instead of contradicting itself: ${incident.summary}`);
assert(
  incident.evidence.some(item => item.includes('invisible to')),
  'the evidence explains why docker and cgroup counters saw nothing'
);

const sigabrt = describeKillCause({ logText: FATAL_V8_LINE, oomKilled: false, exitCode: 134, system: healthySystem });
assert(sigabrt.cause === KILL_CAUSE_OUT_OF_MEMORY, 'exit 134 (SIGABRT) with the same marker is also out-of-memory');

const cleanExit = describeKillCause({ logText: `the docs mention ${FATAL_V8_LINE} as an example\n`, oomKilled: false, exitCode: 0, system: healthySystem });
assert(cleanExit.cause !== KILL_CAUSE_OUT_OF_MEMORY, `a log that merely quotes the fatal line cannot turn a clean exit into an OOM (got ${cleanExit.cause})`);

const plainKill = describeKillCause({ logText: 'nothing unusual happened\n', oomKilled: false, exitCode: 139, system: healthySystem });
assert(plainKill.cause === KILL_CAUSE_FORCED_KILL, `an abnormal exit without any memory evidence is still a forced kill (got ${plainKill.cause})`);

const dockerOom = describeKillCause({ logText: 'nothing unusual\n', oomKilled: true, exitCode: 137, system: healthySystem });
assert(dockerOom.cause === KILL_CAUSE_OUT_OF_MEMORY, 'a container-level OOM is still reported as out-of-memory');

// buildKillDiagnosticsSection must reach the same verdict on a multi-megabyte
// log WITHOUT reading it whole: the injected whole-file reader must stay unused.
const killLogPath = tmp('killed-session.log');
await fs.writeFile(killLogPath, `${'noise line to pad the transcript\n'.repeat(80000)}<--- Last few GCs --->\n${FATAL_V8_LINE}\n`, 'utf8');
const killLogSize = (await fs.stat(killLogPath)).size;
let wholeFileReads = 0;
const { diagnosis } = await buildKillDiagnosticsSection(killLogPath, {
  exitCode: 139,
  oomKilled: false,
  maxLogBytes: 64 * 1024,
  readFile: async () => {
    wholeFileReads += 1;
    return '';
  },
  collectSystem: async () => healthySystem,
});
assert(killLogSize > 2 * 1024 * 1024, `the kill-diagnostics fixture is large (${Math.round(killLogSize / 1024 / 1024)}MB)`);
assert(wholeFileReads === 0, `buildKillDiagnosticsSection never reads a large log whole (whole-file reads=${wholeFileReads})`);
assert(diagnosis?.cause === KILL_CAUSE_OUT_OF_MEMORY, `the bounded tail is enough to classify the abort (got ${diagnosis?.cause})`);

// ---------------------------------------------------------------------------
// 6. attachLogToGitHub decides the route before touching the bytes
// ---------------------------------------------------------------------------
console.log('\n6. attachLogToGitHub route selection\n');

assert(formatLogSizeForHumans(134 * 1024 * 1024) === '134MB', 'formatLogSizeForHumans reports megabytes for large logs');
assert(formatLogSizeForHumans(70 * 1024) === '70KB', 'formatLogSizeForHumans reports kilobytes for small logs');

// A log above GitHub's comment limit must never be read into memory here: the
// route is chosen from `logStats.size` and the file goes straight to the
// streaming uploader.
const oversizedLog = tmp('oversized.log');
await fs.writeFile(oversizedLog, `${'a busy transcript line that says nothing secret\n'.repeat(3000)}`, 'utf8');
const oversizedSize = (await fs.stat(oversizedLog)).size;
assert(oversizedSize > 65536, `the fixture exceeds GitHub's comment limit (${oversizedSize} bytes)`);

// Keep the upload offline: a stub earlier on PATH makes gh-upload-log fail fast.
const stubDir = tmp('bin');
await fs.mkdir(stubDir, { recursive: true });
await fs.writeFile(path.join(stubDir, 'gh-upload-log'), '#!/bin/sh\necho "stubbed upload"\nexit 1\n', { mode: 0o755 });

const readsOfLog = [];
const realReadFile = fsMod.promises.readFile;
const originalPath = process.env.PATH;
const attachLogs = [];
let attachResult;
try {
  process.env.PATH = `${stubDir}${path.delimiter}${originalPath}`;
  fsMod.promises.readFile = async (target, ...rest) => {
    if (String(target) === oversizedLog) readsOfLog.push(String(target));
    return realReadFile(target, ...rest);
  };
  attachResult = await attachLogToGitHub({
    logFile: oversizedLog,
    targetType: 'pr',
    targetNumber: 42,
    owner: 'link-assistant',
    repo: 'hive-mind',
    $: () => async () => ({ code: 0, stdout: 'public', stderr: '' }),
    log: async message => attachLogs.push(String(message)),
  });
} finally {
  fsMod.promises.readFile = realReadFile;
  process.env.PATH = originalPath;
}

assert(readsOfLog.length === 0, `a log too large for a comment is never read into memory by attachLogToGitHub (reads=${readsOfLog.length})`);
assert(
  attachLogs.some(message => message.includes('too large for inline comment')),
  `attachLogToGitHub reports the size-based routing decision: ${JSON.stringify(attachLogs.slice(0, 6))}`
);
assert(attachResult === false, 'a failed upload is reported as a failure rather than a broken link');

// ---------------------------------------------------------------------------
// 7. Source guarantees: exactly one sanitize pass, chosen after the size check
// ---------------------------------------------------------------------------
console.log('\n7. Single sanitize pass on the publication path\n');

const githubSrc = await fs.readFile(path.join(repoRoot, 'src', 'github.lib.mjs'), 'utf8');
const uploadSrc = await fs.readFile(path.join(repoRoot, 'src', 'log-upload.lib.mjs'), 'utf8');

const sizeCheckIndex = githubSrc.indexOf('const canBuildInlineComment =');
const logReadIndex = githubSrc.indexOf("await fs.readFile(logFile, 'utf8')");
assert(sizeCheckIndex > 0, 'attachLogToGitHub derives canBuildInlineComment from the file size');
assert(logReadIndex > sizeCheckIndex, 'the only whole-log read happens after the size-based routing decision');
assert(githubSrc.split("fs.readFile(logFile, 'utf8')").length - 1 === 1, 'attachLogToGitHub reads the log at most once, on the inline-comment branch only');
assert(!githubSrc.includes('writeSanitizedPublicationFile(tempLogFile'), 'the pre-upload sanitized copy (the second full pass) is gone');
assert(/uploadLogWithGhUploadLog\(\{\s*\n?\s*logFile,/.test(githubSrc), 'the raw log path is handed to the uploader, which streams the sanitize itself');
assert(uploadSrc.includes('sanitizeLogFileToFile({'), 'uploadLogWithGhUploadLog sanitizes by streaming');
assert(!/const\s+\w*[Ll]ogContent\s*=\s*await\s+fs\.readFile/.test(uploadSrc), 'uploadLogWithGhUploadLog no longer reads the log into a string');

await fs.rm(workDir, { recursive: true, force: true });

printSummary('Issue #2189 — bounded-memory log handling');
process.exit(getFailCount() > 0 ? 1 : 0);
