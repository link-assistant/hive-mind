#!/usr/bin/env node

/**
 * Tests for issue #1823 (PR #1824) — the experimental
 * `--do-not-shutdown-in-the-middle-of-working-session` working-session guard.
 *
 * Requirement (PR comment): when hive forwards the operator's CTRL+C to a /solve worker, solve
 * must NOT abort the AI tool mid-run. Instead it should let the current AI working session finish,
 * auto-commit any uncommitted changes, and only THEN shut down gracefully. If solve is only
 * idle-waiting (e.g. for CI/CD) it should stop immediately. A SECOND interrupt force-stops now.
 * Backwards compatibility: with the flag OFF, solve's existing SIGINT behavior is unchanged (the
 * only added behavior is auto-commit on SIGTERM — a bug-fix so "all paths" preserve work).
 *
 * Suites:
 *   1. working-session.lib.mjs unit API (state machine + force-kill helper).
 *   2. Static wiring checks across solve.mjs, exit-handler.lib.mjs, interruptible-sleep.lib.mjs,
 *      solve.config.lib.mjs and hive.config.lib.mjs.
 *   3. Integration: a deferred interrupt during a protected session does NOT exit; the process
 *      auto-commits and exits with the signal's code only AFTER the session ends.
 *   4. Integration: a SECOND interrupt during a protected session force-stops (auto-commit + exit).
 *   5. Integration: with the flag OFF, SIGTERM now auto-commits (the "all paths" bug-fix) and the
 *      SIGINT path is unchanged (exits 130).
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const wsPath = join(repoRoot, 'src', 'working-session.lib.mjs');
const exitHandlerPath = join(repoRoot, 'src', 'exit-handler.lib.mjs');

let passed = 0;
let failed = 0;
function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    if (details) console.log(`     ${details}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Suite 1: working-session.lib.mjs unit API
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Suite 1: working-session.lib.mjs unit API');
console.log('─'.repeat(60));

{
  const ws = await import(wsPath);

  ws.resetWorkingSession();
  assert(ws.isFlagEnabled() === false, 'flag defaults to disabled after reset');
  assert(ws.isWorkingSessionActive() === false, 'session inactive after reset');
  assert(ws.isShutdownRequested() === false, 'no shutdown requested after reset');

  ws.configureWorkingSession({ enabled: true });
  assert(ws.isFlagEnabled() === true, 'configureWorkingSession enables the flag');

  ws.beginWorkingSession();
  assert(ws.isWorkingSessionActive() === true, 'beginWorkingSession marks session active');

  // First shutdown request → first=true, recorded, not forced.
  const r1 = ws.requestShutdown('SIGTERM');
  assert(r1.first === true, 'first requestShutdown returns first=true');
  assert(ws.isShutdownRequested() === true, 'shutdown is recorded as requested');
  assert(ws.getShutdownSignal() === 'SIGTERM', 'shutdown signal is recorded');
  assert(ws.isForceRequested() === false, 'first request does not set force');

  // Second shutdown request → first=false, force set.
  const r2 = ws.requestShutdown('SIGINT');
  assert(r2.first === false, 'second requestShutdown returns first=false');
  assert(ws.isForceRequested() === true, 'second request sets force');
  assert(ws.getShutdownSignal() === 'SIGTERM', 'shutdown signal is NOT overwritten by the second request');

  // endWorkingSession reports the recorded state and clears active.
  const endState = ws.endWorkingSession();
  assert(ws.isWorkingSessionActive() === false, 'endWorkingSession marks session inactive');
  assert(endState.shutdownRequested === true && endState.shutdownSignal === 'SIGTERM' && endState.forceRequested === true, 'endWorkingSession returns the recorded shutdown state', `state=${JSON.stringify(endState)}`);

  // forceKillActiveChildren reuses command-stream-like SIGINT listeners and guards process.exit.
  ws.resetWorkingSession();
  let fakeInvoked = 0;
  // Source string must match working-session's command-stream heuristic.
  const fakeCmdStreamListener = () => {
    /* forwardSigintToRunners findActiveRunners */
    fakeInvoked++;
  };
  process.on('SIGINT', fakeCmdStreamListener);
  try {
    const count = ws.forceKillActiveChildren();
    assert(count === 1, 'forceKillActiveChildren finds and invokes the command-stream-like SIGINT listener', `count=${count}`);
    assert(fakeInvoked === 1, 'the command-stream-like listener is invoked exactly once');
    // The temporary no-op guard must be removed again (only our fake listener remains).
    const remaining = process.listeners('SIGINT').filter(l => l === fakeCmdStreamListener);
    assert(remaining.length === 1, 'force-kill leaves the original listener intact and removes its temporary no-op guard');
  } finally {
    process.removeListener('SIGINT', fakeCmdStreamListener);
  }

  // With no command-stream listener present, force-kill is a no-op returning 0.
  const noneRemoved = process.listeners('SIGINT').filter(l => l.toString().includes('forwardSigintToRunners'));
  assert(ws.forceKillActiveChildren() === 0 || noneRemoved.length > 0, 'forceKillActiveChildren returns 0 when no command-stream listener is present');

  ws.resetWorkingSession();
}

// ═══════════════════════════════════════════════════════════════════
// Suite 2: static wiring checks
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Suite 2: static wiring checks');
console.log('─'.repeat(60));

{
  const solve = await readFile(join(repoRoot, 'src', 'solve.mjs'), 'utf-8');
  assert(solve.includes('configureWorkingSession'), 'solve.mjs configures the working-session guard');
  assert(/configureWorkingSession\(\{ enabled: argv\['do-not-shutdown-in-the-middle-of-working-session'\]/.test(solve), 'solve.mjs enables the guard from the CLI flag');
  assert(solve.includes('beginWorkingSession()'), 'solve.mjs begins the AI working session before dispatch');
  assert(solve.includes('endWorkingSession()'), 'solve.mjs ends the AI working session after dispatch');
  assert(solve.includes('workingSessionState.shutdownRequested'), 'solve.mjs honors a deferred shutdown after the session');
  assert(solve.includes('skipPreExit: true'), 'solve.mjs skips the pre-exit failure notifier on graceful shutdown (not a failure)');

  const eh = await readFile(exitHandlerPath, 'utf-8');
  assert(eh.includes('isWorkingSessionFlagEnabled') && eh.includes('isWorkingSessionActive'), 'exit-handler imports the working-session guard');
  assert(eh.includes('requestWorkingSessionShutdown'), 'exit-handler defers shutdown via requestShutdown');
  assert(eh.includes('forceKillWorkingSessionChildren'), 'exit-handler force-kills on a second interrupt');
  assert(/skipPreExit\s*=\s*false/.test(eh), 'safeExit accepts a skipPreExit option');
  // SIGTERM must now also run the interrupt (auto-commit) handler — the "all paths" bug-fix.
  const sigtermStart = eh.indexOf("process.on('SIGTERM'");
  const sigtermBlock = eh.slice(sigtermStart, eh.indexOf('process.on(', sigtermStart + 1));
  assert(sigtermBlock.includes('interruptFunction') && sigtermBlock.includes('interruptHandlerRan'), 'SIGTERM handler runs the interrupt (auto-commit) handler');

  const sleep = await readFile(join(repoRoot, 'src', 'interruptible-sleep.lib.mjs'), 'utf-8');
  assert(sleep.includes("process.on('SIGTERM', onInterrupt)"), 'interruptible-sleep resolves early on SIGTERM (idle/CI-wait stops immediately)');
  assert(sleep.includes("process.on('SIGINT', onInterrupt)"), 'interruptible-sleep still resolves early on SIGINT');

  const solveConfig = await readFile(join(repoRoot, 'src', 'solve.config.lib.mjs'), 'utf-8');
  assert(/'do-not-shutdown-in-the-middle-of-working-session':\s*\{[\s\S]*?default:\s*false/.test(solveConfig), 'solve defines the option with default false (standalone behavior unchanged)');

  const hiveConfig = await readFile(join(repoRoot, 'src', 'hive.config.lib.mjs'), 'utf-8');
  assert(/'do-not-shutdown-in-the-middle-of-working-session':\s*\{[\s\S]*?default:\s*true/.test(hiveConfig), 'hive overrides the option default to true (forwarded to each /solve worker)');
}

// ═══════════════════════════════════════════════════════════════════
// Integration harness (shared by suites 3–5)
// ═══════════════════════════════════════════════════════════════════
const tmp = await mkdtemp(join(tmpdir(), 'ws-1823-'));

/**
 * Build a harness that mirrors solve.mjs's working-session flow.
 *  - FLAG=1 enables the guard. MODE=defer (auto-end session on first request),
 *    MODE=force (keep session active so a 2nd signal force-stops),
 *    MODE=off  (flag disabled; verify default behavior).
 */
const harnessSource = `
import { initializeExitHandler, installGlobalExitHandlers, safeExit } from ${JSON.stringify(exitHandlerPath)};
import { configureWorkingSession, beginWorkingSession, endWorkingSession, isShutdownRequested } from ${JSON.stringify(wsPath)};
import { writeFileSync } from 'node:fs';

const marker = process.env.MARKER;
const FLAG = process.env.FLAG === '1';
const MODE = process.env.MODE;

const doAutoCommit = async () => { writeFileSync(marker, 'AUTO_COMMIT'); };
initializeExitHandler(() => '/tmp/ignored.log', async (m) => { process.stdout.write(String(m) + '\\n'); }, null, doAutoCommit);
installGlobalExitHandlers();
configureWorkingSession({ enabled: FLAG, log: async (m) => { process.stdout.write(String(m) + '\\n'); } });

if (FLAG && MODE !== 'off') {
  beginWorkingSession();
}
process.stdout.write('READY\\n');

if (FLAG && MODE === 'defer') {
  // Mirror solve.mjs: when a deferred shutdown is recorded, end the session, auto-commit, exit.
  const iv = setInterval(async () => {
    if (isShutdownRequested()) {
      clearInterval(iv);
      const state = endWorkingSession();
      process.stdout.write('SESSION_ENDED:' + state.shutdownSignal + '\\n');
      await doAutoCommit();
      await safeExit(state.shutdownSignal === 'SIGINT' ? 130 : 143, 'graceful', { skipPreExit: true });
    }
  }, 25);
}
// MODE=force keeps the session active so the SECOND interrupt force-stops via the exit-handler.
// MODE=off relies entirely on the default exit-handler behavior.
setInterval(() => {}, 1000); // keep alive until signalled
`;
const harnessPath = join(tmp, 'ws-harness.mjs');
await writeFile(harnessPath, harnessSource, 'utf-8');

function runHarness({ flag, mode, signalSequence }) {
  const marker = join(tmp, `marker-${flag}-${mode}-${Math.random().toString(36).slice(2)}.txt`);
  return new Promise(resolve => {
    const child = spawn(process.execPath, [harnessPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MARKER: marker, FLAG: flag ? '1' : '0', MODE: mode },
    });
    let stdout = '';
    let signalsSent = 0;
    const sendNext = () => {
      if (signalsSent >= signalSequence.length) return;
      const sig = signalSequence[signalsSent++];
      try {
        child.kill(sig);
      } catch {
        /* ignore */
      }
      if (signalsSent < signalSequence.length) {
        setTimeout(sendNext, 250);
      }
    };
    child.stdout.on('data', d => {
      stdout += d.toString();
      if (stdout.includes('READY') && signalsSent === 0) {
        setTimeout(sendNext, 100);
      }
    });
    child.on('close', code => {
      let markerContent = '';
      try {
        markerContent = existsSync(marker) ? readFileSync(marker, 'utf-8') : '';
      } catch {
        /* ignore */
      }
      resolve({ code, stdout, marker: markerContent });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// Suite 3: deferred interrupt during a protected session
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Suite 3: deferred interrupt during a protected session');
console.log('─'.repeat(60));

{
  const res = await runHarness({ flag: true, mode: 'defer', signalSequence: ['SIGTERM'] });
  assert(res.stdout.includes('Finishing the current AI working session'), 'first interrupt is deferred (logs "Finishing the current AI working session")', `stdout=${JSON.stringify(res.stdout)}`);
  assert(res.stdout.includes('SESSION_ENDED:SIGTERM'), 'shutdown is honored only AFTER the session ends', `stdout=${JSON.stringify(res.stdout)}`);
  assert(res.marker === 'AUTO_COMMIT', 'graceful shutdown auto-commits uncommitted changes', `marker=${JSON.stringify(res.marker)}`);
  assert(res.code === 143, 'deferred SIGTERM shutdown exits 143 after the session', `code=${res.code}`);
}

// ═══════════════════════════════════════════════════════════════════
// Suite 4: second interrupt force-stops
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Suite 4: second interrupt force-stops during a protected session');
console.log('─'.repeat(60));

{
  const res = await runHarness({ flag: true, mode: 'force', signalSequence: ['SIGINT', 'SIGINT'] });
  assert(res.stdout.includes('Finishing the current AI working session') || res.stdout.includes('Shutdown requested'), 'first interrupt defers', `stdout=${JSON.stringify(res.stdout)}`);
  assert(res.stdout.includes('force-stopping the AI working session now'), 'second interrupt force-stops', `stdout=${JSON.stringify(res.stdout)}`);
  assert(res.marker === 'AUTO_COMMIT', 'force-stop still auto-commits before exiting', `marker=${JSON.stringify(res.marker)}`);
  assert(res.code === 130, 'force-stop via SIGINT exits 130', `code=${res.code}`);
}

// ═══════════════════════════════════════════════════════════════════
// Suite 5: backwards compatibility (flag OFF)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Suite 5: backwards compatibility with the flag OFF');
console.log('─'.repeat(60));

{
  // SIGTERM with the flag OFF now auto-commits (the "all paths" bug-fix) and exits 143.
  const term = await runHarness({ flag: false, mode: 'off', signalSequence: ['SIGTERM'] });
  assert(term.marker === 'AUTO_COMMIT', 'SIGTERM auto-commits even with the flag OFF (all-paths bug-fix)', `marker=${JSON.stringify(term.marker)}`);
  assert(term.code === 143, 'SIGTERM exits 143 with the flag OFF', `code=${term.code}`);

  // SIGINT with the flag OFF is unchanged: auto-commit + exit 130.
  const intr = await runHarness({ flag: false, mode: 'off', signalSequence: ['SIGINT'] });
  assert(intr.marker === 'AUTO_COMMIT', 'SIGINT auto-commits with the flag OFF (unchanged)', `marker=${JSON.stringify(intr.marker)}`);
  assert(intr.code === 130, 'SIGINT exits 130 with the flag OFF (unchanged)', `code=${intr.code}`);
}

await rm(tmp, { recursive: true, force: true });

// ═══════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
