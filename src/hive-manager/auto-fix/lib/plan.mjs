import { createHash } from 'node:crypto';
import { reviewedInstanceCleanup } from '../../storage/cleanup.mjs';
import { daemonFacts, hostDiagnostics, instanceFacts, instanceReady, instanceTasks, mayStartHostDocker, preflight } from './host.mjs';
import { deploymentTarget } from './policy.mjs';

export async function buildPlan(policy, docker, receiptRoot, cleanupDirectory, report = () => {}) {
  const phases = [];
  const blockers = [];
  const actions = [];
  const phase = (name, state, details = undefined) => {
    phases.push({ name, state, details });
    report(phases.at(-1));
  };
  const block = (name, reason) => {
    blockers.push({ phase: name, reason });
    phase(name, 'blocked', reason);
  };
  const check = async (name, probe) => {
    try {
      const result = await probe();
      phase(name, 'completed', result);
      return result;
    } catch (error) {
      block(name, error.message);
      return null;
    }
  };

  const host = await check('host-diagnostics', hostDiagnostics);
  let daemon;
  let actionableStart = false;
  try {
    daemon = await daemonFacts(docker);
    phase('docker', 'completed', daemon);
  } catch {
    actionableStart = policy.startDocker && (await mayStartHostDocker(policy.endpoint));
    if (actionableStart) phase('docker', 'proposed', 'Start the inactive local docker.service and check its API.');
    else block('docker', 'Cannot reach the selected Docker daemon. Check the local socket, permissions and service.');
  }

  const resources = await check('preflight', () => preflight(policy, daemon, receiptRoot));
  const safe = Boolean(host && resources && !resources.blockers.length);
  for (const reason of resources?.blockers ?? []) blockers.push({ phase: 'preflight', reason });
  if (safe && actionableStart) actions.push({ type: 'start-docker' });

  let instance;
  if (daemon) {
    try {
      instance = await instanceFacts(docker, policy.name);
      if (instanceReady(instance)) phase('instance', 'completed', instance);
      else if (policy.startInstance && ['exited', 'created'].includes(instance.status)) {
        phase('instance', 'proposed', instance);
        if (safe) actions.push({ type: 'start-instance', id: instance.id });
      } else block('instance', `Deployment ${policy.name} is ${instance.status}${instance.health ? ` (${instance.health})` : ''}.`);
    } catch {
      block('instance', `Cannot verify the existing deployment ${policy.name}.`);
    }
  } else phase('instance', 'deferred', 'Requires the Docker API.');

  let details;
  if (instance && instanceReady(instance)) {
    try {
      details = await instanceTasks(docker, instance, 'preview', { ...policy, inventoryOnly: !safe });
      phase('task-inventory', 'completed', { tasks: details.inventory, availableMemoryMiB: details.availableMemoryMiB });
    } catch (error) {
      block('task-inventory', error.message);
    }
  } else phase('task-inventory', 'deferred', 'Requires a healthy deployment.');

  if (!policy.cleanupPreview) phase('scoped-cleanup', 'skipped');
  else if (!details) phase('scoped-cleanup', 'deferred', 'Requires task inventory.');
  else {
    try {
      const identity = `${instance.id}/${instance.pid}/${instance.startedAt}`;
      const cleanup = await reviewedInstanceCleanup(cleanupDirectory, policy.endpoint, policy.name, policy.stateDir, policy.cleanupPreview, identity);
      const skipped = cleanup.scopes.find(scope => scope.skipped);
      if (skipped) block('scoped-cleanup', skipped.skipped);
      else if (!cleanup.scopes.some(scope => scope.files > 0)) phase('scoped-cleanup', 'skipped', cleanup);
      else {
        phase('scoped-cleanup', 'proposed', cleanup);
        if (safe) actions.push({ type: 'scoped-cleanup', approval: cleanup.id });
      }
    } catch (error) {
      block('scoped-cleanup', error.message);
    }
  }

  const taskBlocker = !details ? 'Requires task inventory.' : !safe ? 'Requires host memory and storage headroom.' : details.availableMemoryMiB < policy.minMemoryMiB ? `The deployment has less than ${policy.minMemoryMiB} MiB of memory headroom.` : null;
  if (details && safe && taskBlocker && (policy.repairRecords.length || policy.recovery)) blockers.push({ phase: 'task-inventory', reason: taskBlocker });

  if (!policy.repairRecords.length) phase('record-repair', 'skipped');
  else if (taskBlocker) phase('record-repair', 'deferred', taskBlocker);
  else {
    for (const repair of details.repairs) {
      if (repair.state !== 'eligible') blockers.push({ phase: 'record-repair', id: repair.uuid, reason: repair.state });
      else actions.push({ type: 'record-repair', candidate: repair });
    }
    phase('record-repair', 'reviewed', details.repairs);
  }

  if (!policy.recovery) phase('recovery', 'skipped');
  else if (taskBlocker) phase('recovery', 'deferred', taskBlocker);
  else {
    for (const candidate of details.recovery) {
      if (!candidate.approval) blockers.push({ phase: 'recovery', id: candidate.id, reason: candidate.blocked ?? candidate.snapshot.state });
      else actions.push({ type: 'recovery', candidate });
    }
    if (policy.recovery.execution && !details.recovery.length) blockers.push({ phase: 'recovery', id: policy.recovery.execution, reason: 'The selected attempt is ineligible or has a protected family.' });
    phase('recovery', 'reviewed', details.recovery);
  }
  const target = deploymentTarget(policy);
  const fingerprint = actions.map(action => (action.type === 'recovery' ? { type: action.type, approval: action.candidate.approval } : action));
  const approval = actions.length
    ? `sha256:${createHash('sha256')
        .update(JSON.stringify({ version: 1, policy, boot: host.bootId, daemon: daemon?.id, instance, actions: fingerprint }))
        .digest('hex')}`
    : null;
  return { mode: 'preview', target, policy, approval, phases, blockers, actions, boot: host?.bootId, daemon, instance };
}
