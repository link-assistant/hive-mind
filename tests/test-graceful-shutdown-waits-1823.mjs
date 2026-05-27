#!/usr/bin/env node

/**
 * Tests for issue #1823: "Fix all errors on graceful shutdown".
 *
 * Two root causes were fixed:
 *
 *   1. hive spawned `solve` WITHOUT `detached: true`, so a terminal SIGINT (CTRL+C) — or the
 *      \003 that `$ --stop`/screen injects into the PTY — was delivered to the whole foreground
 *      process group: hive, solve, AND codex. That aborted solve/codex mid-turn instead of
 *      letting it finish ("Could not read Codex final message file: ENOENT").
 *
 *   2. A double SIGINT handler race: the global handler from installGlobalExitHandlers()
 *      called process.exit(130) and won the race against hive's gracefulShutdown(), cutting
 *      its `await Promise.all(issueQueue.workers)` short (so "✅ Shutdown complete" never ran).
 *
 * This test verifies:
 *   - Suite 1: exit-handler exposes delegateSignalHandling() and it is reset by resetExitHandler().
 *   - Suite 2: hive.mjs spawns solve detached, owns signals via delegation, tracks children for
 *              force-kill, and no longer blanket-tags stderr as ERROR.
 *   - Suite 3: exit-handler.lib.mjs guards SIGINT/SIGTERM with the delegation flag.
 *   - Suite 4: (integration) when delegation is enabled, the global SIGINT handler stands down
 *              and an external graceful handler completes and exits 0 (vs. 130 by default).
 *   - Suite 5: (integration) a detached child does NOT receive a process-group SIGINT and runs
 *              to completion, whereas a non-detached child is interrupted (reproduces the bug).
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, writeFile, readFile as readFileMaybe, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Spawn a node script, optionally as its own process-group leader (detached), capture stdout,
 * and resolve with { code, stdout, pid } when it exits.
 */
function runScript(scriptPath, { args = [], env = {}, detached = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      detached,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      stdout += d.toString();
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr, pid: child.pid }));
    // Expose handle so callers can signal it before it exits.
    resolve.__child = child;
    child.__resolved = resolve;
  });
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 1: exit-handler delegateSignalHandling API
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 1: exit-handler delegateSignalHandling API');
console.log('─'.repeat(60));

{
  const exitHandler = await import(exitHandlerPath);
  assert(typeof exitHandler.delegateSignalHandling === 'function', 'delegateSignalHandling is exported as a function');
  assert(typeof exitHandler.resetExitHandler === 'function', 'resetExitHandler is exported as a function');
  // Toggling should not throw and resetExitHandler should restore default (no throw).
  let threw = false;
  try {
    exitHandler.delegateSignalHandling(true);
    exitHandler.delegateSignalHandling(false);
    exitHandler.resetExitHandler();
  } catch {
    threw = true;
  }
  assert(!threw, 'delegateSignalHandling()/resetExitHandler() can be toggled without throwing');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2: hive.mjs implements detach + delegation + child tracking
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 2: hive.mjs implementation');
console.log('─'.repeat(60));

{
  const hive = await readFile(join(repoRoot, 'src', 'hive.mjs'), 'utf-8');
  const shutdown = await readFile(join(repoRoot, 'src', 'hive.shutdown.lib.mjs'), 'utf-8');

  // hive.mjs owns: signal delegation, detached spawn, child tracking, neutral stderr tagging,
  // and wiring the shutdown manager.
  assert(hive.includes('delegateSignalHandling'), 'hive.mjs imports/uses delegateSignalHandling');
  assert(hive.includes('delegateSignalHandling(true)'), 'hive.mjs calls delegateSignalHandling(true) to own signals');
  assert(/spawn\(solveCommand, args, \{[\s\S]*?detached: true/.test(hive), 'hive.mjs spawns solve with detached: true (own process group)');
  assert(hive.includes('activeSolveChildren'), 'hive.mjs tracks in-flight solve children (activeSolveChildren)');
  assert(hive.includes('createShutdownManager'), 'hive.mjs wires the shutdown manager (createShutdownManager)');
  assert(hive.includes('gracefulShutdown'), 'hive.mjs registers gracefulShutdown for SIGINT/SIGTERM');
  // The blanket stderr → ERROR tagging must be gone.
  assert(!hive.includes('worker-${workerId} ERROR] ${line}'), 'hive.mjs no longer blanket-tags solve stderr as ERROR');
  assert(hive.includes('worker-${workerId} stderr]'), 'hive.mjs tags solve stderr with a neutral "stderr" marker');
  assert(hive.includes('Issue #1823'), 'hive.mjs references Issue #1823 in comments');

  // hive.shutdown.lib.mjs owns: the uncapped graceful wait + the second-interrupt force-kill.
  assert(shutdown.includes('forceKillActiveSolveChildren'), 'shutdown lib has a force-kill helper for a second interrupt');
  assert(shutdown.includes('process.kill(-child.pid'), 'force-kill targets the whole process group via negative pid');
  assert(shutdown.includes('Received second'), 'a second interrupt triggers force-stop messaging');
  // The graceful wait must remain authoritative (Promise.all over workers).
  assert(shutdown.includes('await Promise.all(issueQueue.workers)'), 'gracefulShutdown still awaits Promise.all(issueQueue.workers)');
  // Issue #1823 (working-session): the first interrupt FORWARDS the operator's CTRL+C to each
  // in-flight solve as SIGTERM (positive pid) so it can finish its AI session and auto-commit.
  assert(shutdown.includes('forwardShutdownToActiveSolveChildren'), 'shutdown lib has a SIGTERM-forwarding helper for the first interrupt');
  assert(shutdown.includes("process.kill(child.pid, 'SIGTERM')"), 'forwarding targets the solve PROCESS via positive pid (command-stream ignores SIGTERM)');

  // hive enables the working-session guard for every solve worker by default (the one CTRL+C change).
  const hiveConfig = await readFile(join(repoRoot, 'src', 'hive.config.lib.mjs'), 'utf-8');
  assert(hiveConfig.includes("'do-not-shutdown-in-the-middle-of-working-session'"), 'hive registers the working-session option');
  assert(/do-not-shutdown-in-the-middle-of-working-session'[\s\S]*?default: true/.test(hiveConfig), 'hive defaults the working-session guard to true (forwarded to each /solve)');

  // hive must treat a graceful-shutdown exit (130/143) as a graceful stop, not a failure.
  assert(/exitCode === 130 \|\| exitCode === 143/.test(hive), 'hive treats solve exit 130/143 during shutdown as a graceful stop');
  assert(hive.includes('gracefulStop'), 'hive tracks a graceful stop so the issue is neither completed nor failed');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 3: exit-handler.lib.mjs guards signals with the flag
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 3: exit-handler.lib.mjs delegation guard');
console.log('─'.repeat(60));

{
  const eh = await readFile(exitHandlerPath, 'utf-8');
  assert(eh.includes('signalHandlingDelegated'), 'exit-handler declares signalHandlingDelegated flag');
  assert(eh.includes('export const delegateSignalHandling'), 'exit-handler exports delegateSignalHandling');
  // Both SIGINT and SIGTERM handlers must contain the delegation guard so they
  // stand down (early return) when an external owner holds the exit.
  const handlerHasGuard = handlerName => {
    const start = eh.indexOf(`process.on('${handlerName}'`);
    if (start === -1) return false;
    // Scope to this handler: from its registration to the next process.on(...) registration.
    const nextHandler = eh.indexOf('process.on(', start + 1);
    const block = eh.slice(start, nextHandler === -1 ? undefined : nextHandler);
    return block.includes('if (signalHandlingDelegated)') && block.includes('return');
  };
  assert(handlerHasGuard('SIGINT'), 'SIGINT handler stands down when delegated');
  assert(handlerHasGuard('SIGTERM'), 'SIGTERM handler stands down when delegated');
  assert(eh.includes('signalHandlingDelegated = false') && eh.indexOf('resetExitHandler') !== -1, 'resetExitHandler resets the delegation flag');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 4 (integration): delegation makes the global SIGINT stand down
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 4: integration — global SIGINT stands down when delegated');
console.log('─'.repeat(60));

{
  const tmp = await mkdtemp(join(tmpdir(), 'hive-1823-delegation-'));
  const harnessPath = join(tmp, 'delegation-harness.mjs');
  const harness = `
import { initializeExitHandler, installGlobalExitHandlers, safeExit, delegateSignalHandling } from ${JSON.stringify(exitHandlerPath)};

initializeExitHandler(() => '/tmp/ignored.log', async (m) => { process.stdout.write(String(m) + '\\n'); });
installGlobalExitHandlers();

const DELEGATE = process.env.DELEGATE === '1';
if (DELEGATE) {
  delegateSignalHandling(true);
  process.on('SIGINT', async () => {
    process.stdout.write('EXTERNAL_HANDLER_START\\n');
    await new Promise(r => setTimeout(r, 400)); // simulate waiting for in-flight work
    process.stdout.write('EXTERNAL_HANDLER_DONE\\n');
    await safeExit(0, 'graceful');
  });
}
process.stdout.write('READY\\n');
setInterval(() => {}, 1000); // keep process alive until signalled
`;
  await writeFile(harnessPath, harness, 'utf-8');

  async function runDelegationCase(delegate) {
    return await new Promise(resolve => {
      const child = spawn(process.execPath, [harnessPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DELEGATE: delegate ? '1' : '0' },
      });
      let stdout = '';
      child.stdout.on('data', d => {
        stdout += d.toString();
        if (stdout.includes('READY') && !child.__signalled) {
          child.__signalled = true;
          // Send SIGINT directly to the harness process (simulates CTRL+C to it).
          setTimeout(() => {
            try {
              child.kill('SIGINT');
            } catch {
              /* ignore */
            }
          }, 100);
        }
      });
      child.on('close', code => resolve({ code, stdout }));
    });
  }

  const delegated = await runDelegationCase(true);
  assert(delegated.code === 0, 'delegated harness exits 0 (external graceful handler owns exit)', `Got code ${delegated.code}, stdout=${JSON.stringify(delegated.stdout)}`);
  assert(delegated.stdout.includes('EXTERNAL_HANDLER_DONE'), 'delegated harness runs the external handler to completion');
  assert(!delegated.stdout.includes('❌ Interrupted (CTRL+C)'), 'delegated harness does NOT print the global "Interrupted (CTRL+C)" message');

  const def = await runDelegationCase(false);
  assert(def.code === 130, 'non-delegated harness exits 130 via the global SIGINT handler (default behavior preserved)', `Got code ${def.code}, stdout=${JSON.stringify(def.stdout)}`);
  assert(def.stdout.includes('Interrupted (CTRL+C)'), 'non-delegated harness prints the global "Interrupted (CTRL+C)" message');

  await rm(tmp, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 5 (integration): detached child survives a process-group SIGINT
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 5: integration — detached solve survives a group SIGINT');
console.log('─'.repeat(60));

{
  const tmp = await mkdtemp(join(tmpdir(), 'hive-1823-detach-'));
  const childPath = join(tmp, 'detach-child.mjs');
  const harnessPath = join(tmp, 'detach-harness.mjs');

  // Child writes COMPLETED on natural finish, INTERRUPTED if it receives SIGINT.
  const childScript = `
import { writeFileSync } from 'node:fs';
const marker = process.argv[2];
process.on('SIGINT', () => { try { writeFileSync(marker, 'INTERRUPTED'); } catch {} process.exit(1); });
setTimeout(() => { try { writeFileSync(marker, 'COMPLETED'); } catch {} process.exit(0); }, 1500);
`;
  await writeFile(childPath, childScript, 'utf-8');

  // Harness spawns the child (detached controlled by env) and waits for it (graceful: ignore SIGINT).
  const harnessScript = `
import { spawn } from 'node:child_process';
const DETACHED = process.env.DETACHED === '1';
const marker = process.env.MARKER;
const child = spawn(process.execPath, [${JSON.stringify(childPath)}, marker], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: DETACHED,
});
child.on('close', code => { process.stdout.write('CHILD_CLOSED:' + code + '\\n'); process.exit(0); });
// Graceful: on SIGINT we do NOT exit; we keep waiting for the child to finish naturally.
process.on('SIGINT', () => { process.stdout.write('HARNESS_SIGINT\\n'); });
process.stdout.write('READY\\n');
setInterval(() => {}, 1000);
`;
  await writeFile(harnessPath, harnessScript, 'utf-8');

  async function runDetachCase(detached) {
    const marker = join(tmp, `marker-${detached ? 'detached' : 'attached'}.txt`);
    return await new Promise(resolve => {
      // Spawn the harness as its OWN process-group leader so we can signal the whole group,
      // exactly like a terminal/screen delivers SIGINT to its foreground process group.
      const harness = spawn(process.execPath, [harnessPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DETACHED: detached ? '1' : '0', MARKER: marker },
        detached: true,
      });
      let stdout = '';
      harness.stdout.on('data', d => {
        stdout += d.toString();
        if (stdout.includes('READY') && !harness.__signalled) {
          harness.__signalled = true;
          setTimeout(() => {
            try {
              // Negative PID → signal the entire harness process group (terminal-like).
              process.kill(-harness.pid, 'SIGINT');
            } catch {
              /* ignore */
            }
          }, 150);
        }
      });
      harness.on('close', async () => {
        let marker_content = '';
        try {
          marker_content = existsSync(marker) ? await readFileMaybe(marker, 'utf-8') : '';
        } catch {
          /* ignore */
        }
        resolve({ stdout, marker: marker_content });
      });
    });
  }

  const detached = await runDetachCase(true);
  assert(detached.marker === 'COMPLETED', 'detached child finishes naturally despite group SIGINT (the fix)', `marker=${JSON.stringify(detached.marker)}, stdout=${JSON.stringify(detached.stdout)}`);

  const attached = await runDetachCase(false);
  assert(attached.marker === 'INTERRUPTED', 'non-detached child IS interrupted by the group SIGINT (reproduces the bug)', `marker=${JSON.stringify(attached.marker)}, stdout=${JSON.stringify(attached.stdout)}`);

  await rm(tmp, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 6 (unit): createShutdownManager runtime behavior with mocks
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 6: createShutdownManager runtime behavior');
console.log('─'.repeat(60));

{
  const { createShutdownManager } = await import(join(repoRoot, 'src', 'hive.shutdown.lib.mjs'));

  // Mock process.kill so we can observe force-kill calls without touching real processes.
  const realKill = process.kill;
  const killCalls = [];
  process.kill = (pid, sig) => {
    killCalls.push({ pid, sig });
  };

  try {
    // --- Case A: FIRST interrupt waits for workers, exits 0, does NOT force-kill. ---
    {
      let workersResolved = false;
      const workers = [
        new Promise(r =>
          setTimeout(() => {
            workersResolved = true;
            r();
          }, 200)
        ),
      ];
      const exitCalls = [];
      const mgr = createShutdownManager({
        log: async () => {},
        safeExit: async (code, reason) => {
          exitCalls.push({ code, reason });
        },
        reportError: () => {},
        cleanErrorMessage: e => e.message,
        cleanupTempDirectories: async () => {},
        issueQueue: { stop: () => {}, getStats: () => ({ processing: 1, completed: 0 }), workers },
        argv: {},
        absoluteLogPath: '/tmp/ignored.log',
        activeSolveChildren: new Set([{ pid: 999999 }]),
      });

      const before = killCalls.length;
      await mgr.gracefulShutdown('interrupt');
      const firstInterruptKills = killCalls.slice(before);
      assert(workersResolved, 'first interrupt awaits Promise.all(workers) before exiting');
      assert(exitCalls.length === 1 && exitCalls[0].code === 0, 'first interrupt exits 0 after workers finish naturally', `exitCalls=${JSON.stringify(exitCalls)}`);
      // Issue #1823: the first interrupt now FORWARDS the operator's CTRL+C to each in-flight solve
      // as SIGTERM (positive pid) so it can finish its AI working session and auto-commit, but it
      // must NOT force-kill the process group (negative pid) — that escalation is reserved for a
      // second interrupt.
      assert(
        firstInterruptKills.some(k => k.pid === 999999 && k.sig === 'SIGTERM'),
        'first interrupt forwards SIGTERM to the solve process (positive pid)',
        `kills=${JSON.stringify(firstInterruptKills)}`
      );
      assert(!firstInterruptKills.some(k => k.pid < 0), 'first interrupt does NOT force-kill the solve process group (no negative pid)', `kills=${JSON.stringify(firstInterruptKills)}`);
    }

    // --- Case B: SECOND interrupt force-kills the process group and exits 130. ---
    {
      const workers = [new Promise(r => setTimeout(r, 600))];
      const exitCalls = [];
      const mgr = createShutdownManager({
        log: async () => {},
        safeExit: async (code, reason) => {
          exitCalls.push({ code, reason });
        },
        reportError: () => {},
        cleanErrorMessage: e => e.message,
        cleanupTempDirectories: async () => {},
        issueQueue: { stop: () => {}, getStats: () => ({ processing: 1, completed: 0 }), workers },
        argv: {},
        absoluteLogPath: '/tmp/ignored.log',
        activeSolveChildren: new Set([{ pid: 12345 }]),
      });

      const first = mgr.gracefulShutdown('interrupt'); // parks on await Promise.all(workers)
      await sleep(60); // let it enter the waiting state (isShuttingDown = true)
      await mgr.gracefulShutdown('interrupt'); // second interrupt → force-kill + exit 130
      assert(
        killCalls.some(k => k.pid === -12345),
        'second interrupt force-kills the solve process group via negative pid',
        `killCalls=${JSON.stringify(killCalls)}`
      );
      assert(
        exitCalls.some(e => e.code === 130),
        'second interrupt exits 130 immediately',
        `exitCalls=${JSON.stringify(exitCalls)}`
      );
      await first; // let the parked first call unwind
    }
  } finally {
    process.kill = realKill;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
