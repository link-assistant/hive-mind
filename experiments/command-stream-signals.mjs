#!/usr/bin/env node
/**
 * Experiment for issue #1823: validate command-stream's SIGINT/SIGTERM behavior.
 *
 * Goal: confirm the design assumptions for --do-not-shutdown-in-the-middle-of-working-session
 *   (A) command-stream forwards SIGINT to its child (kills it) when a `$` child is active.
 *   (B) command-stream does NOT react to SIGTERM at all (no process-level listener).
 *   (C) When another SIGINT handler is registered, command-stream does NOT call process.exit.
 *   (D) Removing command-stream's SIGINT listener prevents the child kill on SIGINT,
 *       but command-stream re-installs it on the next `$` invocation.
 *
 * Run: node experiments/command-stream-signals.mjs <scenario>
 *   scenarios: sigint-default | sigterm-default | sigint-removed
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;
const { $ } = await use('command-stream');

const scenario = process.argv[2] || 'sigint-default';
const log = (...a) => console.log(`[${scenario}]`, ...a);

// Count SIGINT listeners that look like command-stream's.
function csListeners() {
  return process.listeners('SIGINT').filter(l => {
    const s = l.toString();
    return s.includes('findActiveRunners') || s.includes('forwardSigintToRunners') || s.includes('handleSigintExit');
  });
}

let childKilled = false;
let ownHandlerRan = false;

// Register our own SIGINT handler so command-stream sees "other handlers" and won't exit.
process.on('SIGINT', () => {
  ownHandlerRan = true;
  log('OWN SIGINT handler ran');
});

// Start a long-running child via command-stream (streams in background).
const runner = $`sh -c 'trap "echo CHILD_GOT_SIGTERM; exit 143" TERM; trap "echo CHILD_GOT_SIGINT; exit 130" INT; for i in $(seq 1 20); do echo tick-$i; sleep 0.3; done; echo CHILD_DONE_NATURALLY'`;

const startedPromise = runner.start ? runner.start() : runner;

// Give the child a moment to spawn.
await new Promise(r => setTimeout(r, 600));
log('command-stream SIGINT listeners present:', csListeners().length);

if (scenario === 'sigint-removed') {
  // Remove command-stream's SIGINT listener to protect the working session.
  for (const l of csListeners()) process.removeListener('SIGINT', l);
  log('Removed command-stream SIGINT listeners; remaining:', csListeners().length);
}

// Track child exit.
startedPromise
  .then(res => {
    log('child finished, code=', res?.code, 'stdout tail=', JSON.stringify((res?.stdout || '').trim().split('\n').slice(-2)));
  })
  .catch(err => {
    log('child promise rejected:', err?.message || err);
  });

// Send the signal to ourselves.
await new Promise(r => setTimeout(r, 200));
if (scenario.startsWith('sigint')) {
  log('sending SIGINT to self');
  process.kill(process.pid, 'SIGINT');
} else if (scenario.startsWith('sigterm')) {
  log('sending SIGTERM to self');
  process.kill(process.pid, 'SIGTERM');
}

// Wait to observe outcome.
await new Promise(r => setTimeout(r, 2500));
log('FINAL: ownHandlerRan=', ownHandlerRan, 'process still alive=true');
log('FINAL: SIGINT listeners now =', process.listeners('SIGINT').length, 'cs=', csListeners().length);
process.exit(0);
