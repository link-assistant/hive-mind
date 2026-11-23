import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { createSessionStore } from '../../session-store.lib.mjs';
import { withStateLock } from '../../state-lock.lib.mjs';
import { aliasResumeCommand, solveTask, issueTarget } from './lib/recovery-command.mjs';
import { docker, snapshotSpace } from './lib/snapshot-space.mjs';
import { latestAttempt, taskAttempts } from './lib/inspection.mjs';
import { readExecutionStore } from './lib/read-execution-store.mjs';
import { observedWatchers } from './lib/watchers.mjs';
import { listTrackedTasks } from './report.mjs';

const execFileAsync = promisify(execFile);
const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const usage = `Usage: hive-manager tasks recover-failed [--limit NUMBER] [--apply [--wait SECONDS]]
       hive-manager tasks recover-failed --execution UUID --attempt NUMBER [--max-resumes NUMBER] [--apply [--wait SECONDS]]
Preview stopped, detached Docker tasks with confirmed out-of-memory evidence.
Select the exact execution and failed attempt to review a known Telegram alias exit 127 or a later memory failure.
The default permits one resume. Set --max-resumes (1–10) to review a later attempt.
Only --apply resumes eligible tasks after rechecking the record and snapshot headroom.
With --wait, track the new attempts to completion and report their exit codes.
`;

function taskFacts(task) {
  const { options } = task;
  const family = options?.rootSession || options?.sessionNameHistory?.[0] || options?.sessionName;
  const resumes = Number(options?.resumeCount ?? 0);
  return {
    task,
    ...solveTask(task.command),
    family,
    container: options?.sessionName || (resumes === 0 ? family : null),
    resumes,
    attempt: latestAttempt(task),
    startedAt: Date.parse(task.attempt?.startedAt || options?.resumedAt || task.startTime),
  };
}

function eligible({ task, container, attempt, resumes, alias, knownAlias }, policy) {
  if (!uuidPattern.test(task.uuid ?? '') || task.status !== 'executed' || !Number.isInteger(task.exitCode) || task.exitCode <= 0) return false;
  if (!/^[a-zA-Z\d][a-zA-Z\d_.-]*$/.test(container ?? '') || task.options?.isolated !== 'docker' || task.options.isolationMode !== 'detached' || task.options.stopRequestedAt) return false;
  if (!Number.isSafeInteger(resumes) || resumes < 0 || !Number.isSafeInteger(attempt) || attempt <= resumes || attempt > policy.maxResumes) return false;
  if (policy.execution && (task.uuid !== policy.execution || attempt !== policy.attempt)) return false;
  if (alias) return Boolean(policy.execution && knownAlias && task.exitCode === 127);
  return task.oomKilled === true || task.memoryExhausted === true;
}

function belongsTo(name, family) {
  return Boolean(family && (name === family || name?.startsWith(`${family}-resume-`)));
}

function recoveryPlan(executions, containers, sessions, policy) {
  const tasks = executions.map(taskFacts);
  const busyTargets = new Set(
    sessions
      .filter(({ sessionInfo }) => sessionInfo.launchPending)
      .map(({ sessionInfo }) => issueTarget(sessionInfo.url))
      .filter(Boolean)
  );
  const busyFamilies = new Set();
  for (const { task, target, family, container } of tasks) {
    const active = containers.some(active => active.uuid === task.uuid || active.name === container || (family && (active.family === family || belongsTo(active.name, family))));
    const tracked = sessions.some(({ sessionName, sessionInfo }) => sessionInfo.executionUuid === task.uuid || belongsTo(sessionName, family) || (family && sessionInfo.rootSessionName === family));
    if (active || tracked || task.status === 'executing' || task.paused === true || task.options?.launchPending === true) {
      if (target) busyTargets.add(target);
      if (family) busyFamilies.add(family);
    }
  }

  const checkedTargets = new Set();
  const checkedFamilies = new Set();
  const candidates = [];
  const recent = tasks.filter(({ startedAt }) => Number.isFinite(startedAt)).sort((a, b) => b.startedAt - a.startedAt);
  for (const entry of recent) {
    const { target, family } = entry;
    const checked = checkedTargets.has(target) || checkedFamilies.has(family);
    if (target) checkedTargets.add(target);
    if (family) checkedFamilies.add(family);
    if (checked || !target || !family || busyTargets.has(target) || busyFamilies.has(family) || !eligible(entry, policy)) continue;
    candidates.push(entry);
    if (candidates.length >= policy.limit) break;
  }
  return candidates;
}

async function currentPlan(policy) {
  const executions = policy.profile ? await readExecutionStore({ allowMissing: true }) : await listTrackedTasks();
  let active;
  try {
    active = await docker(['ps', '--format', '{{.Names}}\t{{.Label "start-command.root-session"}}\t{{.Label "start-command.uuid"}}']);
  } catch {
    throw new Error('Could not inspect running Docker tasks. Check access to the task daemon.');
  }
  const containers = active
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [name, family, uuid] = line.split('\t');
      return { name, family, uuid };
    });
  return recoveryPlan(executions, containers, await createSessionStore().load({ strict: policy.profile }), policy);
}

async function reviewCandidate(entry, requireIdentity, watchers) {
  const { task, container, family, alias, attempt, target } = entry;
  const { uuid: id, exitCode, endTime } = task;
  const snapshot = await snapshotSpace({ id, family, container, containerId: task.options.containerId, exitCode, requireIdentity });
  const command = alias ? await aliasResumeCommand(task, alias, target) : undefined;
  const candidate = { id, attempt, nextAttempt: attempt + 1, exitCode, finishedAt: endTime ?? null, recovery: alias ? 'telegram-alias' : 'memory-exhaustion', snapshot };
  if (alias && !command) candidate.blocked = 'unrecognized-alias-arguments';
  if (watchers?.has(container) || watchers?.has(snapshot.containerId?.slice(7))) candidate.blocked = 'completion-watcher-present';
  if (requireIdentity && snapshot.state === 'ready' && !candidate.blocked) {
    candidate.approval = `sha256:${createHash('sha256')
      .update(JSON.stringify([id, attempt, entry.startedAt, endTime, exitCode, family, snapshot.containerId, task.command, command]))
      .digest('hex')}`;
  }
  return { candidate, command };
}

async function resumeCandidate(id, command) {
  const override = command === undefined ? [] : ['--', command];
  await execFileAsync('$', ['--resume', id, '--output-format', 'json', ...override], { timeout: 120_000, maxBuffer: 1024 * 1024 });
}

const recoveryLock = action => withStateLock('hive-manager-task-recovery', action, { timeoutMs: 5000, staleMs: 60 * 60 * 1000 });

export async function previewProfileRecovery(policy) {
  const entries = await currentPlan(policy);
  const candidates = [];
  if (!entries.length) return candidates;
  const watchers = await observedWatchers();
  for (const entry of entries) candidates.push((await reviewCandidate(entry, true, watchers)).candidate);
  return candidates;
}

export async function applyProfileRecovery(policy, { id, attempt, approval }) {
  return recoveryLock(async () => {
    const entry = (await currentPlan({ ...policy, execution: id, attempt, limit: 1 })).find(({ task }) => task.uuid === id);
    if (!entry) return { id, attempt, state: 'changed' };
    const { candidate, command } = await reviewCandidate(entry, true, await observedWatchers());
    if (!candidate.approval || candidate.approval !== approval) return { id, attempt, state: 'changed', snapshot: candidate.snapshot };
    try {
      await resumeCandidate(id, command);
      return { id, attempt, nextAttempt: candidate.nextAttempt, state: 'resumed' };
    } catch {
      return { id, attempt, state: 'resume-unconfirmed' };
    }
  });
}

function sameFailure(a, b) {
  return a.attempt === b.attempt && a.startedAt === b.startedAt && a.container === b.container && a.task.options.containerId === b.task.options.containerId && a.task.exitCode === b.task.exitCode && a.task.endTime === b.task.endTime && a.task.command === b.task.command;
}

async function followRecoveries(outcomes, attempts, seconds) {
  const pending = new Set(outcomes.filter(outcome => outcome.state === 'resumed'));
  const deadline = performance.now() + seconds * 1000;
  while (pending.size && performance.now() < deadline) {
    try {
      const tasks = await listTrackedTasks(Math.max(1, Math.ceil(deadline - performance.now())));
      const byId = new Map(tasks.map(task => [task.uuid, task]));
      for (const outcome of pending) {
        const task = byId.get(outcome.id);
        const attempt = task && taskAttempts(task).get(attempts.get(outcome.id));
        if (!['executed', 'failed'].includes(attempt?.status)) continue;
        outcome.completion = { attempt: attempt.number, exitCode: Number.isInteger(attempt.exitCode) ? attempt.exitCode : null, finishedAt: attempt.endTime ?? attempt.finishedAt ?? null };
        pending.delete(outcome);
      }
    } catch (error) {
      if (performance.now() < deadline) throw error;
    }
    if (pending.size) await delay(Math.min(2000, Math.max(0, deadline - performance.now())));
  }
  for (const outcome of pending) outcome.completion = null;
}

function integerInRange(value, upper) {
  const number = Number(value);
  return /^\d+$/.test(value ?? '') && number >= 1 && number <= upper;
}

async function recoverFailed() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, limit: { type: 'string' }, execution: { type: 'string' }, attempt: { type: 'string' }, 'max-resumes': { type: 'string' }, apply: { type: 'boolean' }, wait: { type: 'string' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const execution = values.execution?.toLowerCase();
  const maxResumes = values['max-resumes'] ?? '1';
  if (!integerInRange(values.limit ?? '3', 10)) throw new Error('Recovery limit must be between 1 and 10.');
  if (!integerInRange(maxResumes, 10) || (values['max-resumes'] !== undefined && execution === undefined)) throw new Error('--max-resumes requires --execution and a limit between 1 and 10.');
  if ((execution !== undefined || values.attempt !== undefined) && (!uuidPattern.test(execution ?? '') || !integerInRange(values.attempt, 10) || values.limit !== undefined)) throw new Error('Select a complete --execution UUID and its --attempt (1–10) separately from --limit.');
  if (values.wait !== undefined && (!values.apply || !integerInRange(values.wait, 3600))) throw new Error('--wait requires --apply and between 1 and 3600 seconds.');
  const policy = { execution, attempt: Number(values.attempt), maxResumes: Number(maxResumes), limit: execution ? 1 : Number(values.limit ?? '3') };
  const attempts = new Map();
  const action = async () => {
    const entries = await currentPlan(policy);
    const candidates = [];
    const outcomes = [];
    for (const entry of entries) {
      const { candidate } = await reviewCandidate(entry);
      candidates.push(candidate);
      if (!values.apply) continue;
      const { id, nextAttempt } = candidate;
      const current = (await currentPlan({ ...policy, limit: 10 })).find(({ task }) => task.uuid === id);
      if (!current || !sameFailure(entry, current)) {
        outcomes.push({ id, state: 'changed' });
        continue;
      }
      const review = await reviewCandidate(current);
      const blocked = review.candidate.blocked ?? (review.candidate.snapshot.state === 'ready' ? null : review.candidate.snapshot.state);
      if (blocked) {
        outcomes.push({ id, state: 'blocked', reason: blocked, snapshot: review.candidate.snapshot });
        continue;
      }
      try {
        await resumeCandidate(id, review.command);
        attempts.set(id, nextAttempt);
        outcomes.push({ id, state: 'resumed' });
      } catch {
        outcomes.push({ id, state: 'resume-failed' });
        break;
      }
    }
    return { mode: values.apply ? 'apply' : 'preview', candidates, outcomes };
  };
  const result = values.apply ? await recoveryLock(action) : await action();
  if (values.wait) await followRecoveries(result.outcomes, attempts, Number(values.wait));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.outcomes.some(({ state }) => state === 'resume-failed')) throw new Error('A resume could not be confirmed. Check tasks status before retrying.');
  if (values.apply && execution && !result.candidates.length) throw new Error('The selected attempt is no longer eligible. Check tasks status and the recovery limit.');
  if (result.outcomes.some(({ state, completion }) => state !== 'resumed' || (values.wait && completion?.exitCode !== 0))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await recoverFailed();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
