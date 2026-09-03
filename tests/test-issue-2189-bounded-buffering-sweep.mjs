#!/usr/bin/env node

/**
 * Regression: no log-sized `readFile` survives anywhere in Hive Mind (#2189).
 *
 * The incident that opened issue #2189 was one unbounded read on the
 * `--attach-logs` path, but the same shape existed all over the codebase: any
 * artifact whose size is decided by how long an AI ran (a solve log, a Claude or
 * Codex JSONL transcript, a development-log copy of either) was being read with
 * `fs.readFile(path, 'utf8')` — and usually transformed once or twice more,
 * multiplying the allocation. Issue #2189 asks for the fix "in all of them":
 *
 *   > no unbounded buffering anywhere in Hive Mind. Log capture, session
 *   > monitoring and comment building should all be memory-bounded.
 *
 * Each section below drives the real code path and proves the whole-file read is
 * gone by making one impossible: `fs.promises.readFile` is patched to throw when
 * it is handed the artifact under test.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { promises as fs } from 'node:fs';
import fsMod from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { writeDevelopmentLogArtifacts } from '../src/development-log.lib.mjs';
import { repairCorruptedThinkingBlocks, resolveSessionTranscriptPath } from '../src/claude.session-transcript-repair.lib.mjs';
import { calculateSessionTokens } from '../src/claude.lib.mjs';
import { forEachLogLine, fileEndsWithNewline } from '../src/log-bounded-read.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-2189-sweep-'));

const SECRET = `ghp_${'b'.repeat(36)}`;

console.log('================================================================================');
console.log('Regression: bounded buffering across the whole codebase (#2189)');
console.log('================================================================================\n');

/**
 * Run `fn` with `fs.promises.readFile` refusing to read `guardedPath`.
 * `use('fs')` returns the very same module object, so this covers both import styles.
 */
const withGuardedReadFile = async (guardedPath, fn) => {
  const original = fsMod.promises.readFile;
  const resolved = path.resolve(guardedPath);
  let blocked = 0;
  fsMod.promises.readFile = async (file, ...rest) => {
    if (typeof file === 'string' && path.resolve(file) === resolved) {
      blocked += 1;
      throw new Error(`issue #2189: whole-file read of ${file} is not allowed`);
    }
    return original.call(fsMod.promises, file, ...rest);
  };
  try {
    return { result: await fn(), blocked };
  } finally {
    fsMod.promises.readFile = original;
  }
};

// ---------------------------------------------------------------------------
// 1. forEachLogLine / fileEndsWithNewline
// ---------------------------------------------------------------------------
console.log('1. Line streaming primitives\n');

const linesFile = path.join(workDir, 'records.jsonl');
await fs.writeFile(linesFile, 'a\nb\n\nc\n', 'utf8');
const seen = [];
const visited = await forEachLogLine(linesFile, line => void seen.push(line));
assert(seen.join('|') === 'a|b||c', `every record is visited in order (got ${JSON.stringify(seen)})`);
assert(visited === 4, `the visited count matches (${visited})`);

const stoppedAt = [];
await forEachLogLine(linesFile, line => {
  stoppedAt.push(line);
  return line === 'b' ? false : undefined;
});
assert(stoppedAt.join('|') === 'a|b', 'returning false stops the walk early');

assert((await fileEndsWithNewline(linesFile)) === true, 'a trailing newline is detected');
await fs.writeFile(path.join(workDir, 'no-nl.txt'), 'x', 'utf8');
assert((await fileEndsWithNewline(path.join(workDir, 'no-nl.txt'))) === false, 'a missing trailing newline is detected');
assert((await fileEndsWithNewline(path.join(workDir, 'absent.txt'))) === false, 'a missing file is not reported as newline-terminated');

// ---------------------------------------------------------------------------
// 2. Development-log collection (--development-log)
// ---------------------------------------------------------------------------
console.log('\n2. Development-log artifacts stream source → destination\n');

const repositoryPath = path.join(workDir, 'repo');
await fs.mkdir(path.join(repositoryPath, 'logs'), { recursive: true });
const solveLogPath = path.join(repositoryPath, 'logs', 'solve.log');
const filler = `${'x'.repeat(199)}\n`;
const prefix = `PREFIX LINE THAT PRECEDES THE SLICE\n${filler.repeat(500)}`;
const sliceBody = `${filler.repeat(9000)}token=${SECRET}\ntail marker line\n`;
await fs.writeFile(solveLogPath, prefix + sliceBody, 'utf8');
const solveLogSize = (await fs.stat(solveLogPath)).size;
assert(solveLogSize > 1024 * 1024, `the fixture log is bigger than one sanitize block (${solveLogSize} bytes)`);

const homeDir = path.join(workDir, 'home');
const claudeSessionId = '11111111-2222-3333-4444-555555555555';
const claudeProjectDir = path.join(homeDir, '.claude', 'projects', repositoryPath.replace(/\//g, '-'));
await fs.mkdir(claudeProjectDir, { recursive: true });
const claudeTranscript = path.join(claudeProjectDir, `${claudeSessionId}.jsonl`);
await fs.writeFile(claudeTranscript, `${JSON.stringify({ type: 'user', text: `key ${SECRET}` })}\n${filler.repeat(6000)}`, 'utf8');

const collection = await withGuardedReadFile(solveLogPath, () =>
  writeDevelopmentLogArtifacts({
    repositoryPath,
    logFile: solveLogPath,
    issueNumber: 2189,
    prNumber: 2191,
    tool: 'claude',
    sessionId: claudeSessionId,
    branchName: 'issue-2189',
    rawCommand: 'solve https://example.invalid/issues/1 --development-log',
    logStartByte: prefix.length,
    homeDir,
  })
);
const artifacts = collection.result;
assert(collection.blocked === 0, 'development-log collection never asks for the whole solve log');

const copiedLog = path.join(repositoryPath, artifacts.copiedLogRelativePath);
const copiedText = await fs.readFile(copiedLog, 'utf8');
assert(!copiedText.includes(SECRET), 'the copied slice is sanitized');
assert(copiedText.includes('token='), 'the copied slice keeps its surrounding text');
assert(!copiedText.includes('PREFIX LINE THAT PRECEDES THE SLICE'), 'the copy starts at logStartByte (issue #2090 slicing is preserved)');
assert(copiedText.trimEnd().endsWith('tail marker line'), 'the copy ends at the end of the log');
assert(((await fs.stat(copiedLog)).mode & 0o777) === 0o600, 'the copied slice is private (0600)');

const copiedTranscript = path.join(repositoryPath, artifacts.sessionFiles[0].replace(/^\.\//, ''));
const copiedTranscriptText = await fs.readFile(copiedTranscript, 'utf8');
assert(!copiedTranscriptText.includes(SECRET), 'the copied session transcript is sanitized');

// A second collection for the same session must overwrite, not fail on O_EXCL.
const recollection = await writeDevelopmentLogArtifacts({ repositoryPath, logFile: solveLogPath, issueNumber: 2189, prNumber: 2191, tool: 'claude', sessionId: claudeSessionId, branchName: 'issue-2189', rawCommand: 'solve', logStartByte: prefix.length, homeDir });
assert(recollection.copiedLogRelativePath === artifacts.copiedLogRelativePath, 'a repeated collection reuses the same session directory without failing');

// ---------------------------------------------------------------------------
// 3. Claude transcript repair (issue #1834 behaviour, streamed)
// ---------------------------------------------------------------------------
console.log('\n3. Transcript repair rewrites without holding the transcript\n');

const repairHome = path.join(workDir, 'repair-home');
const repairCwd = '/tmp/hive-2189-repair';
const repairSessionId = '99999999-8888-7777-6666-555555555555';
const repairFile = resolveSessionTranscriptPath(repairCwd, repairSessionId, repairHome);
await fs.mkdir(path.dirname(repairFile), { recursive: true });

const corruptedEntry = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', signature: 'Eyc' },
      { type: 'text', text: 'hello' },
    ],
  },
};
const healthyEntry = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'fine' }] } };
const onlyCorruptedEntry = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] } };
const transcriptLines = [];
for (let index = 0; index < 400; index++) {
  transcriptLines.push(JSON.stringify({ ...healthyEntry, index }));
  if (index % 100 === 0) transcriptLines.push(JSON.stringify(corruptedEntry));
}
transcriptLines.push(JSON.stringify(onlyCorruptedEntry));
transcriptLines.push('not json at all');
const transcriptText = `${transcriptLines.join('\n')}\n`;
await fs.writeFile(repairFile, transcriptText, 'utf8');
await fs.chmod(repairFile, 0o640);

// The legacy whole-file algorithm, kept here as the oracle the stream must match.
const legacyRepair = text =>
  text
    .split('\n')
    .map(line => {
      if (!line.trim()) return line;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return line;
      }
      const content = entry?.message?.content;
      if (!Array.isArray(content)) return line;
      const corrupted = content.filter(block => block?.type === 'thinking' && !block.thinking).length;
      if (corrupted === 0) return line;
      const cleaned = content.filter(block => !(block?.type === 'thinking' && !block.thinking));
      if (cleaned.length === 0) return line;
      entry.message.content = cleaned;
      return JSON.stringify(entry);
    })
    .join('\n');

const repairRun = await withGuardedReadFile(repairFile, () => repairCorruptedThinkingBlocks({ tempDir: repairCwd, sessionId: repairSessionId, homeDir: repairHome }));
const repairResult = repairRun.result;
assert(repairRun.blocked === 0, 'the repair never reads the transcript whole');
assert(repairResult.repaired === true, `the transcript is repaired (${repairResult.reason || 'ok'})`);
assert(repairResult.removedBlocks === 4, `every corrupted block outside an all-thinking message is removed (${repairResult.removedBlocks})`);
assert(repairResult.scannedLines === transcriptLines.length, `every non-blank line is counted (${repairResult.scannedLines} of ${transcriptLines.length})`);

const repairedText = await fs.readFile(repairFile, 'utf8');
assert(repairedText === legacyRepair(transcriptText), 'the streamed rewrite is byte-identical to the whole-file algorithm');
assert(repairedText.endsWith('\n'), 'the trailing newline is preserved');
assert(((await fs.stat(repairFile)).mode & 0o777) === 0o640, 'the transcript keeps its original permissions');
assert((await fs.readFile(`${repairFile}.pre-repair-backup`, 'utf8')) === transcriptText, 'the pre-repair backup holds the original transcript');
assert(
  (await fs.readdir(path.dirname(repairFile))).every(name => !name.includes('.repair-')),
  'no temp file is left behind'
);

const secondRun = await repairCorruptedThinkingBlocks({ tempDir: repairCwd, sessionId: repairSessionId, homeDir: repairHome });
assert(secondRun.repaired === false && secondRun.reason === 'no corrupted thinking blocks found', 'a repaired transcript is not rewritten again');

const noNewlineFile = resolveSessionTranscriptPath(repairCwd, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', repairHome);
await fs.writeFile(noNewlineFile, `${JSON.stringify(healthyEntry)}\n${JSON.stringify(corruptedEntry)}`, 'utf8');
await repairCorruptedThinkingBlocks({ tempDir: repairCwd, sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', homeDir: repairHome });
assert(!(await fs.readFile(noNewlineFile, 'utf8')).endsWith('\n'), 'a transcript without a trailing newline does not gain one');

const missing = await repairCorruptedThinkingBlocks({ tempDir: repairCwd, sessionId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', homeDir: repairHome });
assert(missing.repaired === false && missing.reason === 'session transcript not found', 'a missing transcript still degrades gracefully');

// ---------------------------------------------------------------------------
// 4. Per-session token accounting
// ---------------------------------------------------------------------------
console.log('\n4. Token accounting streams the session JSONL\n');

const tokensHome = path.join(workDir, 'tokens-home');
const tokensCwd = '/tmp/hive-2189-tokens';
const tokensSessionId = '12121212-3434-5656-7878-909090909090';
const tokensFile = resolveSessionTranscriptPath(tokensCwd, tokensSessionId, tokensHome);
await fs.mkdir(path.dirname(tokensFile), { recursive: true });
const usageLine = (id, input, output) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-test-model', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 10 } } });
await fs.writeFile(
  tokensFile,
  [
    usageLine('msg-1', 100, 20),
    usageLine('msg-1', 100, 20), // duplicate (issue #1501)
    'not json',
    '',
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-01-01T00:00:00Z', compactMetadata: { preTokens: 500, trigger: 'auto' } }),
    usageLine('msg-2', 300, 40),
  ].join('\n') + '\n',
  'utf8'
);

const tokensRun = await withGuardedReadFile(tokensFile, () => calculateSessionTokens(tokensSessionId, tokensCwd, null, { homeDir: tokensHome, fetchModelInfo: async () => null }));
const tokens = tokensRun.result;
assert(tokensRun.blocked === 0, 'token accounting never reads the transcript whole');
assert(tokens.inputTokens === 400, `input tokens are summed across records (${tokens?.inputTokens})`);
assert(tokens.outputTokens === 60, `output tokens are summed across records (${tokens?.outputTokens})`);
assert(tokens.duplicateEntriesSkipped === 1, `duplicate message ids are still skipped (${tokens?.duplicateEntriesSkipped})`);
assert(tokens.subSessions.length === 2, `compact boundaries still split sub-sessions (${tokens?.subSessions?.length})`);
assert(tokens.compactifications?.[0]?.preTokens === 500, 'compactification metadata is still collected');
assert(tokens.peakContextUsage === 310, `peak restored context still counts cache reads (${tokens?.peakContextUsage})`);

// ---------------------------------------------------------------------------
// 5. Source guarantees for the remaining log consumers
// ---------------------------------------------------------------------------
console.log('\n5. Source guarantees\n');

const readSource = async name => fs.readFile(path.join(repoRoot, 'src', name), 'utf8');

const logCommandSrc = await readSource('telegram-log-command.lib.mjs');
assert(!/fs\.readFile\(logPath/.test(logCommandSrc), '/log no longer reads the session log into a string');
assert(/sanitizeLogFileToFileBounded\(\{ sourcePath: logPath, destPath: sanitizedPath \}\)/.test(logCommandSrc), '/log streams the sanitized upload artifact');

const watchSrc = await readSource('telegram-terminal-watch-command.lib.mjs');
assert(!/fs\.readFile\(logPath/.test(watchSrc), '/terminal_watch no longer re-reads the whole log every tick');
assert(/readLogTailText\(logPath, \{ maxBytes: TERMINAL_WATCH_TAIL_BYTES \}\)/.test(watchSrc), '/terminal_watch reads a bounded tail');

const devLogSrc = await readSource('development-log.lib.mjs');
assert(!/fs\.readFile\(/.test(devLogSrc), 'development-log collection has no whole-file read left');
assert(/findResidualCredentialBlock\(filePath\)/.test(devLogSrc), 'the publication rescan is streamed');

const errorReporterSrc = await readSource('github-error-reporter.lib.mjs');
assert(/formatLogFileForIssue/.test(errorReporterSrc), 'the error reporter routes by file size');
assert(/const \{ size \} = await fs\.stat\(logFilePath\)/.test(errorReporterSrc), 'the error reporter stats the log before reading it');

await fs.rm(workDir, { recursive: true, force: true });

printSummary('Issue #2189 — bounded buffering sweep');
process.exit(getFailCount() > 0 ? 1 : 0);
