#!/usr/bin/env node

/**
 * Regression test for issue #2160: session logs must be renamed to `<sessionId>.log` in every
 * session path, including restart/watch/auto-merge iterations.
 *
 * Reported symptom (hive run 4c1dedd8-a645-479c-84ce-72a0f8d7d179, 4 occurrences):
 *   ⚠️ Could not rename log file: getLogFile is not a function
 *
 * Root cause: src/solve.restart-shared.lib.mjs called executeClaude() without forwarding
 * `getLogFile`/`setLogFile`, and passed no-op stubs (`() => {}` / `() => ''`) to the other tool
 * executors. src/claude.lib.mjs then called `getLogFile()` on `undefined`.
 *
 * Fix: src/session-log-rename.lib.mjs is the single implementation (it reports a named reason
 * instead of throwing a TypeError), and solve.restart-shared.lib.mjs forwards the real accessors
 * exported by src/lib.mjs to every tool executor.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renameLogToSessionId } from '../src/session-log-rename.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFileSync(join(__dirname, '..', 'src', name), 'utf8');

console.log('================================================================================');
console.log('Regression: session log renaming in every session path (Issue #2160)');
console.log('================================================================================\n');

console.log('Behavior of src/session-log-rename.lib.mjs:\n');

await test('renames the current log file to <sessionId>.log and updates the accessor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hm-2160-'));
  let current = join(dir, 'run.log');
  writeFileSync(current, 'log body');
  const result = await renameLogToSessionId({
    sessionId: 'abc-123',
    getLogFile: () => current,
    setLogFile: p => {
      current = p;
    },
  });
  assert(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert(current === join(dir, 'abc-123.log'), `accessor should point at the renamed file, got ${current}`);
  assert(existsSync(current), 'renamed file should exist on disk');
  assert(!existsSync(join(dir, 'run.log')), 'the original log file should be gone');
  assert(readFileSync(current, 'utf8') === 'log body', 'log contents must be preserved');
});

await test('reports missing_log_file_accessors instead of throwing a TypeError', async () => {
  // This is the exact regression: the caller forgot to forward getLogFile/setLogFile.
  const messages = [];
  const result = await renameLogToSessionId({ sessionId: 'abc-123', log: async m => messages.push(m) });
  assert(!result.ok && result.reason === 'missing_log_file_accessors', `expected missing_log_file_accessors, got ${JSON.stringify(result)}`);
  assert(!messages.some(m => m.includes('is not a function')), `the TypeError must not surface to the log: ${JSON.stringify(messages)}`);
});

await test('treats no-op stub accessors as a missing log file, without throwing', async () => {
  const result = await renameLogToSessionId({ sessionId: 'abc-123', getLogFile: () => '', setLogFile: () => {} });
  assert(!result.ok && result.reason === 'no_current_log_file', `expected no_current_log_file, got ${JSON.stringify(result)}`);
});

await test('skips when there is no session id', async () => {
  const result = await renameLogToSessionId({ sessionId: undefined, getLogFile: () => '/tmp/x.log', setLogFile: () => {} });
  assert(!result.ok && result.reason === 'missing_session_id', `expected missing_session_id, got ${JSON.stringify(result)}`);
});

await test('is idempotent when the log is already named after the session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hm-2160-'));
  const current = join(dir, 'sid.log');
  writeFileSync(current, 'x');
  const result = await renameLogToSessionId({ sessionId: 'sid', getLogFile: () => current, setLogFile: () => {} });
  assert(result.ok && result.reason === 'already_named', `expected already_named, got ${JSON.stringify(result)}`);
});

await test('surfaces rename failures as rename_failed without throwing', async () => {
  const result = await renameLogToSessionId({
    sessionId: 'sid',
    getLogFile: () => '/nonexistent-dir-2160/run.log',
    setLogFile: () => {},
  });
  assert(!result.ok && result.reason === 'rename_failed' && result.error, `expected rename_failed, got ${JSON.stringify(result)}`);
});

console.log('\nWiring into every tool execution path:\n');

const restartSrc = readSrc('solve.restart-shared.lib.mjs');
const claudeSrc = readSrc('claude.lib.mjs');

await test('claude.lib.mjs uses the shared helper instead of inline rename logic', () => {
  assert(claudeSrc.includes("from './session-log-rename.lib.mjs'"), 'claude.lib.mjs should import session-log-rename.lib.mjs');
  assert(claudeSrc.includes('renameLogToSessionId('), 'claude.lib.mjs should call renameLogToSessionId');
  assert(!claudeSrc.includes('await fs.rename(currentLogFile, sessionLogFile)'), 'the inline rename must be gone');
});

await test('solve.restart-shared.lib.mjs no longer passes no-op log-file stubs', () => {
  assert(!restartSrc.includes('setLogFile: () => {}'), 'no-op setLogFile stubs must be gone');
  assert(!restartSrc.includes("getLogFile: () => ''"), 'no-op getLogFile stubs must be gone');
  assert(restartSrc.includes('const { log, formatAligned, extractToolErrorCore, getLogFile, setLogFile } = lib;'), 'the real accessors must be imported from lib.mjs');
});

await test('every tool executor call in a restart iteration forwards both accessors', () => {
  const iterationStart = restartSrc.indexOf('export const executeToolIteration');
  assert(iterationStart !== -1, 'executeToolIteration should exist');
  const body = restartSrc.slice(iterationStart);
  // Issue #2182 wrapped the tool-execution body in a try/finally, so the calls
  // are no longer at a fixed indentation. Match the closing brace at whatever
  // indentation it sits at instead of hard-coding four spaces.
  const calls = [...body.matchAll(/await execute(Claude|OpenCode|Codex|Agent|Gemini|Qwen)\(\{([\s\S]*?)\n[ \t]*\}\);/g)];
  assert(calls.length >= 6, `expected all six tool executor calls, found ${calls.length}`);
  for (const [, tool, args] of calls) {
    assert(/\n\s+setLogFile,/.test(args), `execute${tool} must forward setLogFile`);
    assert(/\n\s+getLogFile,/.test(args), `execute${tool} must forward getLogFile`);
  }
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
