#!/usr/bin/env node
/**
 * Tests for issue #1927 (second location): /terminal_watch must not hang forever
 * on a SIGKILL/OOM-killed session.
 *
 * The watch loop decided "completed" purely from `$ --status`. When
 * start-command keeps reporting `executing` after the wrapped command was
 * killed (the RC-1 lingering-shell flip), the watch would poll forever and keep
 * rendering a misleading "running" snapshot — the same silent-hang that left the
 * killed `/solve` in issue #1927 unreported, here in the watch path.
 *
 * The fix cross-checks the authoritative execution-log FOOTER ("Exit Code: N"):
 * once present the session is finished, the displayed status is corrected to the
 * real terminal status (e.g. `killed`), and the watch stops and reports it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { reconcileWatchCompletion, watchTerminalLogSession, formatTerminalWatchMessage } from '../src/telegram-terminal-watch-command.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

const isTerminalSessionStatus = status => ['executed', 'killed', 'terminated', 'failed', 'completed'].includes(status);

function footer(exitCode, finished = '2026-06-14 19:10:49.822') {
  return `\n${'='.repeat(50)}\nFinished: ${finished}\nExit Code: ${exitCode}\n`;
}

console.log('Testing issue #1927: /terminal_watch kill detection');
console.log('='.repeat(60));

console.log('\n  reconcileWatchCompletion — footer is authoritative:');

// A non-terminal status whose log footer records a SIGKILL must be treated as
// finished, with the displayed status corrected to the real terminal status.
const killed = reconcileWatchCompletion({ exists: true, status: 'executing', exitCode: null }, `working...${footer(137)}`, isTerminalSessionStatus);
assert(killed.completed === true, 'executing status + exit-137 footer is reported completed');
assert(killed.statusResult.status === 'killed', 'corrected status is "killed" for exit 137');
assert(killed.statusResult.exitCode === 137, 'corrected exit code is recovered from the footer');

// SIGTERM (143) classifies as an orderly termination.
const term = reconcileWatchCompletion({ exists: true, status: 'executing', exitCode: null }, `bye${footer(143)}`, isTerminalSessionStatus);
assert(term.completed === true && term.statusResult.status === 'terminated', 'executing status + exit-143 footer corrects to "terminated"');

// A clean exit recorded in the footer corrects to "executed".
const ok = reconcileWatchCompletion({ exists: true, status: 'executing', exitCode: null }, `done${footer(0)}`, isTerminalSessionStatus);
assert(ok.completed === true && ok.statusResult.status === 'executed', 'executing status + exit-0 footer corrects to "executed"');

// No footer yet → still running; status is left untouched.
const running = reconcileWatchCompletion({ exists: true, status: 'executing', exitCode: null }, 'still going, no footer yet\n', isTerminalSessionStatus);
assert(running.completed === false, 'executing status with no footer is still running');
assert(running.statusResult.status === 'executing', 'status is left untouched while still running');

// A genuinely-terminal status is trusted directly (status takes precedence).
const directTerminal = reconcileWatchCompletion({ exists: true, status: 'executed', exitCode: 0 }, 'no footer', isTerminalSessionStatus);
assert(directTerminal.completed === true && directTerminal.statusResult.status === 'executed', 'a terminal status is reported completed without needing a footer');

// Resilient to a missing/empty status payload.
const noStatus = reconcileWatchCompletion(null, `oom${footer(137)}`, isTerminalSessionStatus);
assert(noStatus.completed === true && noStatus.statusResult.status === 'killed', 'footer still completes the watch when the status payload is absent');

console.log('\n  formatTerminalWatchMessage — killed completion is surfaced, not a ✅:');
const killedMsg = formatTerminalWatchMessage({ sessionId: 'u', statusResult: { status: 'killed' }, logText: 'x', completed: true });
assert(killedMsg.includes('❌'), 'a killed completion renders the ❌ failure marker');
assert(killedMsg.includes('Terminal watch complete'), 'the failure title still contains "Terminal watch complete"');
assert(killedMsg.includes('Status: `killed`'), 'the killed status is shown on the Status line');
const okMsg = formatTerminalWatchMessage({ sessionId: 'u', statusResult: { status: 'executed' }, logText: 'x', completed: true });
assert(okMsg.includes('✅ Terminal watch complete'), 'a successful completion keeps the ✅ success title');

console.log('\n  watchTerminalLogSession — stops when the footer records a kill (status stays executing):');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-1927-kill-'));
const logPath = path.join(tempDir, 'sess.log');
await fs.writeFile(logPath, 'booting...\n');

const edits = [];
let statusCalls = 0;
watchTerminalLogSession({
  bot: { telegram: { editMessageText: async (...args) => edits.push(args) } },
  chatId: 1,
  messageId: 2,
  sessionId: 'sess',
  logPath,
  options: { width: 80, height: 10, intervalMs: 10, maxChars: 1000 },
  // start-command NEVER reports terminal here — it keeps saying `executing`,
  // exactly the RC-1 lingering-shell flip. Only the footer reveals the kill.
  querySessionStatus: async () => {
    statusCalls++;
    if (statusCalls === 2) await fs.writeFile(logPath, `crashing${footer(137)}`);
    return { exists: true, uuid: 'sess', status: 'executing', exitCode: null, logPath, isolation: 'screen' };
  },
  isTerminalSessionStatus,
});

await new Promise(resolve => setTimeout(resolve, 120));
const callsAfterFooter = statusCalls;
await new Promise(resolve => setTimeout(resolve, 60));

assert(edits.length >= 1, 'the watch edits the message at least once', { editCount: edits.length });
const finalMessage = String(edits.at(-1)?.[3] || '');
assert(finalMessage.includes('Terminal watch complete'), 'the watch freezes a completion message even though status never went terminal');
assert(finalMessage.includes('❌') && finalMessage.includes('Status: `killed`'), 'the frozen message reports the kill, not a perpetual executing');
assert(statusCalls === callsAfterFooter, 'the watch stops polling after the footer is detected (no infinite loop)', { callsAfterFooter, statusCalls });

await fs.rm(tempDir, { recursive: true, force: true });

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
