#!/usr/bin/env node

/**
 * Issue #2189: "on startup the bot should resume all still-running / interrupted
 * commands" — the isolation backend's half of it.
 *
 * Replaying the durable session store (issue #1927) restores *Hive Mind's* view.
 * It cannot restore `$`'s: the detached-docker completion watchers are children
 * of the process that launched them, so a bot restart leaves every running
 * container unsupervised and an execution that ends while the bot is down never
 * gets its exit written. `$ --resume-all` (start-command >= 0.33.0) re-attaches
 * a watcher to what is alive and finalizes what died meanwhile.
 *
 * What is locked in here:
 *   1. the reconciliation runs *before* the store is replayed, so the first
 *      monitor tick reads settled state;
 *   2. its outcome is summarized for the operator and recorded as an event;
 *   3. an older `$` without the verb, a refusal, or a thrown error can never
 *      stop the bot from coming up, and the sessions are replayed regardless.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-foundation/start/issues/162
 */

import { resumeSessionsOnLaunch } from '../src/bot-lifecycle.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2189: startup reconciles still-running isolated executions');
console.log('='.repeat(78));

const captureLogger = () => {
  const events = [];
  const errors = [];
  return { events, errors, event: (type, data) => events.push({ type, data }), error: (message, meta) => errors.push({ message, meta }) };
};
const captureConsole = () => {
  const log = [];
  const error = [];
  return { log, error, impl: { log: m => log.push(String(m)), error: m => error.push(String(m)) } };
};

// ---------------------------------------------------------------------------
// 1. Ordering and reporting
// ---------------------------------------------------------------------------
console.log('\n1. `$ --resume-all` runs before the durable store is replayed');

const order = [];
const logger = captureLogger();
const con = captureConsole();
const out = await resumeSessionsOnLaunch({
  resumeTrackedSessions: async () => {
    order.push('replay');
    return { resumed: [{ sessionName: 'uuid-a' }], skipped: [] };
  },
  reconcileIsolationSessions: async ({ verbose }) => {
    order.push(`reconcile:${verbose}`);
    return {
      success: true,
      unsupported: false,
      executions: [
        { uuid: 'u-1', action: 'reattached', state: 'running' },
        { uuid: 'u-2', action: 'reconciled', state: 'missing', exitCode: 137 },
        { uuid: 'u-3', action: 'running', state: 'running' },
      ],
      error: null,
    };
  },
  botStartTime: 1000,
  verbose: true,
  logger,
  consoleImpl: con.impl,
});

assert(JSON.stringify(order) === JSON.stringify(['reconcile:true', 'replay']), 'the isolation backend is reconciled before the durable store is replayed');
assert(out.reconciliation.reattached === 1 && out.reconciliation.reconciled === 1 && out.reconciliation.running === 1, 'each `--resume-all` action is counted');
assert(
  con.log.some(l => /Reconciled 3 isolated execution\(s\)/.test(l)),
  'the operator is told what the reconciliation did'
);
const event = logger.events.find(e => e.type === 'isolation_executions_reconciled');
assert(event && event.data.reconciled === 1 && event.data.reattached === 1, 'the reconciliation is recorded as a durable event');
assert(out.resumed.length === 1, 'the durable store is still replayed');

// ---------------------------------------------------------------------------
// 2. Nothing to reconcile, and no reconciler at all
// ---------------------------------------------------------------------------
console.log('\n2. Quiet when there is nothing to do');

const quietCon = captureConsole();
const quiet = await resumeSessionsOnLaunch({
  resumeTrackedSessions: async () => ({ resumed: [], skipped: [] }),
  reconcileIsolationSessions: async () => ({ success: true, unsupported: false, executions: [], error: null }),
  botStartTime: 1,
  logger: captureLogger(),
  consoleImpl: quietCon.impl,
});
assert(quiet.reconciliation.attempted === true && quiet.reconciliation.reconciled === 0, 'an empty reconciliation is attempted and reports nothing');
assert(!quietCon.log.some(l => /Reconciled/.test(l)), 'no reconciliation line is printed when nothing changed');

const noRunner = await resumeSessionsOnLaunch({ resumeTrackedSessions: async () => ({ resumed: [], skipped: [] }), botStartTime: 1, logger: captureLogger(), consoleImpl: captureConsole().impl });
assert(noRunner.reconciliation.attempted === false, 'a bot without isolation skips the reconciliation entirely');

// ---------------------------------------------------------------------------
// 3. A reconciliation can never block startup
// ---------------------------------------------------------------------------
console.log('\n3. Startup survives every reconciliation outcome');

const unsupportedCon = captureConsole();
const unsupported = await resumeSessionsOnLaunch({
  resumeTrackedSessions: async () => ({ resumed: [{ sessionName: 'uuid-a' }], skipped: [] }),
  reconcileIsolationSessions: async () => ({ success: false, unsupported: true, executions: [], error: 'Error: Unknown wrapper option: --resume-all' }),
  botStartTime: 1,
  verbose: true,
  logger: captureLogger(),
  consoleImpl: unsupportedCon.impl,
});
assert(unsupported.reconciliation.unsupported === true && unsupported.reconciliation.error === null, 'an older `$` without --resume-all is not reported as an error');
assert(unsupported.resumed.length === 1, 'an older `$` does not stop the sessions from being replayed');

const refused = await resumeSessionsOnLaunch({
  resumeTrackedSessions: async () => ({ resumed: [], skipped: [] }),
  reconcileIsolationSessions: async () => ({ success: false, unsupported: false, executions: [], error: 'store is locked' }),
  botStartTime: 1,
  logger: captureLogger(),
  consoleImpl: captureConsole().impl,
});
assert(refused.reconciliation.error === 'store is locked', 'a real refusal is reported with its reason');

const thrownCon = captureConsole();
const thrown = await resumeSessionsOnLaunch({
  resumeTrackedSessions: async () => ({ resumed: [{ sessionName: 'uuid-a' }], skipped: [] }),
  reconcileIsolationSessions: async () => {
    throw new Error('docker daemon is not running');
  },
  botStartTime: 1,
  logger: captureLogger(),
  consoleImpl: thrownCon.impl,
});
assert(thrown.resumed.length === 1, 'a thrown reconciliation still lets the bot come up and replay its sessions');
assert(thrown.reconciliation.error === 'docker daemon is not running', 'the thrown reason is kept for the record');
assert(
  thrownCon.error.some(l => /Could not reconcile isolated executions/.test(l)),
  'the failure is surfaced to the operator'
);

printSummary(78);
process.exit(getFailCount() > 0 ? 1 : 0);
