import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { jobDirectory, launchCleanup, readCleanupStatus, reviewedInstanceCleanup } from '../storage/cleanup.mjs';
import { executionId } from '../storage/lib/docker.mjs';
import { output } from '../storage/lib/process.mjs';
import { bootId, daemonFacts, hostDocker, instanceFacts, instanceReady, instanceTasks, mayStartHostDocker, preflight, sameInstance } from './lib/host.mjs';
import { buildPlan } from './lib/plan.mjs';
import { autoFixPolicy, deploymentTarget, digestPattern, namePattern } from './lib/policy.mjs';
import { loadReceipt, receiptDirectory, receiptRoot, receiptStatus, saveReceipt } from './lib/receipts.mjs';

const entry = fileURLToPath(new URL('./main.mjs', import.meta.url));
const time = () => new Date().toISOString();
const needsReview = state => ['interrupted', 'uncertain'].includes(state?.status);

class Blocked extends Error {}

function requireHost(apply = false) {
  if (process.platform !== 'linux') throw new Error('Run auto-fix on the Linux Docker daemon host.');
  if (apply && process.getuid() !== 0) throw new Error('Apply and status require root on the Linux Docker daemon host.');
}

export async function previewAutoFix(options) {
  requireHost();
  const policy = autoFixPolicy(options);
  const { mode, target, approval, phases, blockers, actions } = await buildPlan(policy, hostDocker(policy), receiptRoot, jobDirectory);
  return { mode, target, approval, phases, blockers, actions };
}

export async function applyAutoFix(options, approval, { afterInterruption } = {}) {
  requireHost(true);
  return launchAutoFix(autoFixPolicy(options), approval, afterInterruption);
}

export async function getAutoFixStatus({ name }, { runId } = {}) {
  requireHost(true);
  if (!namePattern.test(name ?? '')) throw new Error('Select a valid deployment name.');
  const receipt = await receiptStatus(receiptDirectory(receiptRoot, name), runId);
  if (!receipt && runId !== undefined) throw new Error('No auto-fix receipt has this run UUID for the selected deployment.');
  return receipt ?? { status: 'idle' };
}

function checkPrior(previous, approval, afterInterruption) {
  if (previous?.status === 'running') throw new Error(`Auto-fix is already running. Check --status for run ${previous.id}.`);
  if (needsReview(previous) && previous.id !== afterInterruption) {
    throw new Error(`Review run ${previous.id} before another apply. Supply its ID with --after-interruption after reconciliation.`);
  }
  if (afterInterruption && (!needsReview(previous) || previous.id !== afterInterruption)) throw new Error('The interruption acknowledgement does not match the latest unresolved run.');
  return previous?.status === 'completed' && previous.approval === approval;
}

export async function launchAutoFix(policy, approval, afterInterruption, root = receiptRoot) {
  if (!digestPattern.test(approval ?? '') || (afterInterruption && !executionId.test(afterInterruption))) throw new Error('Supply a plan digest and, when applicable, a complete interrupted run UUID.');
  const directory = receiptDirectory(root, policy.name, true);
  const previous = await receiptStatus(directory);
  if (checkPrior(previous, approval, afterInterruption)) return previous;
  if (afterInterruption && (await readCleanupStatus(jobDirectory))?.status === 'running') throw new Error('Wait for the detached cleanup worker before another apply.');
  const id = randomUUID();
  const child = spawn('flock', ['-n', '-E', '75', join(directory, 'lock'), process.execPath, entry, '--worker', root, id, approval, afterInterruption ?? '', JSON.stringify(policy)], { detached: true, stdio: 'ignore' });
  child.unref();
  let exit;
  child.on('error', error => {
    exit = error;
  });
  child.on('exit', code => {
    exit = code ?? 1;
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    const receipt = loadReceipt(directory, id);
    if (receipt) return receipt;
    if (exit !== undefined) break;
    await delay(100);
  }
  if (exit instanceof Error) throw exit;
  const current = await receiptStatus(directory);
  if (checkPrior(current, approval, afterInterruption)) return current;
  if (exit === 75) throw new Error('Another auto-fix holds the deployment lock. Check --status.');
  throw new Error('Auto-fix startup could not be confirmed. Check --status before applying again.');
}

async function waitUntil(probe, ready) {
  let last;
  for (let retry = 0; retry < 20; retry++) {
    try {
      last = await probe();
      if (ready(last)) return last;
    } catch {
      // The API or the selected container can be briefly unavailable during startup.
    }
    await delay(1000);
  }
  throw new Error('Startup could not be confirmed. Check the Docker service and deployment state.');
}

async function prepareAction(action, policy, plan, docker, root) {
  try {
    if (bootId() !== plan.boot) throw new Error('The host boot changed.');
    const daemon = plan.daemon && (await daemonFacts(docker));
    if (daemon && (plan.daemon.id !== daemon.id || plan.daemon.root !== daemon.root)) throw new Error('The Docker daemon changed.');
    const resources = preflight(policy, daemon, root);
    if (resources.blockers.length) throw new Error(resources.blockers.join(' '));
    if (action.type === 'start-docker') {
      if (!(await mayStartHostDocker(policy.endpoint))) throw new Error('The local Docker service state changed.');
      return;
    }
    const instance = await instanceFacts(docker, policy.name);
    if (!sameInstance(plan.instance, instance) || (action.type !== 'start-instance' && !instanceReady(instance))) throw new Error('The deployment changed or became unavailable.');
    if (action.type === 'scoped-cleanup') {
      await reviewedInstanceCleanup(jobDirectory, policy.endpoint, policy.name, policy.stateDir, action.approval, `${instance.id}/${instance.pid}/${instance.startedAt}`);
    }
    return instance;
  } catch (error) {
    throw new Blocked(error.message);
  }
}

async function performAction(action, policy, docker, instance, progress) {
  switch (action.type) {
    case 'start-docker':
      await output('systemctl', ['start', 'docker.service'], { ms: 60_000 });
      return waitUntil(() => daemonFacts(docker), Boolean);
    case 'start-instance': {
      await docker(['start', '--', action.id], { ms: 65_000 });
      return waitUntil(
        () => instanceFacts(docker, policy.name),
        current => current.id === action.id && instanceReady(current)
      );
    }
    case 'scoped-cleanup': {
      let result = await launchCleanup(jobDirectory, policy.endpoint.slice(7), policy.name, policy.stateDir, action.approval, true);
      const id = result.id;
      progress({ cleanupRunId: id });
      for (let retry = 0; result?.id === id && result.status === 'running' && retry < 930; retry++) {
        await delay(2000);
        result = await readCleanupStatus(jobDirectory);
      }
      if (result?.id !== id || result.status !== 'completed') throw new Error(`Cleanup completion could not be confirmed for run ${id}.`);
      if (result.scopes.some(scope => scope.skipped)) throw new Error(`Cleanup run ${id} skipped part of its approved scope. Review its scope receipt.`);
      return result;
    }
    case 'record-repair':
    case 'recovery': {
      const repair = action.type === 'record-repair';
      const result = await instanceTasks(docker, instance, repair ? 'repair' : 'recover', policy, action.candidate);
      if (['changed', 'ambiguous'].includes(result.state) || (repair && !result.state)) throw new Blocked('The reviewed task changed or its watcher is already present.');
      if (result.state !== (repair ? 'repaired' : 'resumed')) {
        progress({ result });
        throw new Error(repair ? 'Watcher attachment could not be confirmed.' : 'Task resume could not be confirmed.');
      }
      return result;
    }
    default:
      throw new Error('Unknown auto-fix action.');
  }
}

export async function autoFixWorker(root, id, approval, afterInterruption, policy) {
  if (!namePattern.test(policy.name ?? '') || !executionId.test(id) || !digestPattern.test(approval) || (afterInterruption && !executionId.test(afterInterruption))) throw new Error('Invalid auto-fix worker input.');
  const directory = receiptDirectory(root, policy.name);
  // A receipt still marked running while this worker owns the lock is from
  // an interrupted process. No previous action is replayed automatically.
  const prior = loadReceipt(directory);
  const previous = prior?.status === 'running' ? { ...prior, status: 'interrupted' } : prior;
  if (checkPrior(previous, approval, afterInterruption)) return;
  // A detached cleanup can hold its lock after its parent was interrupted.
  if (afterInterruption && (await readCleanupStatus(jobDirectory))?.status === 'running') throw new Error('Wait for the detached cleanup worker before another apply.');
  const receipt = { id, mode: 'apply', status: 'running', target: deploymentTarget(policy), approval, afterInterruption: afterInterruption || null, startedAt: time(), phases: [], actions: [] };
  const save = () => saveReceipt(directory, receipt);
  saveReceipt(directory, receipt, true);
  let step;
  try {
    const docker = hostDocker(policy);
    const plan = await buildPlan(policy, docker, root, jobDirectory, phase => {
      receipt.phases.push(phase);
      save();
    });
    receipt.blockers = plan.blockers;
    if (plan.approval !== approval) throw new Blocked('The reviewed plan has changed. Run a fresh preview before applying.');
    receipt.actions = plan.actions.map(action => ({ ...action, state: 'pending' }));
    save();
    for (const action of receipt.actions) {
      step = action;
      const instance = await prepareAction(action, policy, plan, docker, root);
      Object.assign(step, { state: 'running', startedAt: time() });
      save();
      const result = await performAction(action, policy, docker, instance, details => {
        Object.assign(step, details);
        save();
      });
      Object.assign(step, { state: 'completed', result, finishedAt: time() });
      save();
      step = undefined;
    }
    receipt.status = 'completed';
  } catch (error) {
    receipt.status = step?.state === 'running' && !(error instanceof Blocked) ? 'uncertain' : 'blocked';
    receipt.error = error.message;
    if (step) Object.assign(step, { state: receipt.status, finishedAt: time() });
  }
  receipt.finishedAt = time();
  save();
}
