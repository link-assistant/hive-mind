import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs, promisify } from 'node:util';
import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';
import { listTrackedTasks, taskAttempts } from './hive-manager-task-report.mjs';

const execFileAsync = promisify(execFile);
const usage = `Usage: hive-manager tasks recover-failed [--limit NUMBER] [--apply [--wait SECONDS]]
Plan recovery of detached Hive Mind Docker tasks with out-of-memory evidence.
Only --apply resumes eligible tasks. Tasks with recorded retries are skipped.
With --wait, track the new attempts to completion and report their exit codes.
`;

function taskTarget(command) {
  if (typeof command !== 'string') return null;
  const match = /(?:^\s*|;\s*exec\s+)(?:'solve'|solve)\s+['"]?(https:\/\/github\.com\/[^\s'";]+)(?:['"]?(?:\s|$))/i.exec(command);
  if (!match) return null;
  const target = parseGitHubUrl(match[1], { recover: false });
  return target.valid && ['issue', 'pull'].includes(target.type) ? target.canonical.toLowerCase() : null;
}

function taskFacts(task) {
  return {
    task,
    target: taskTarget(task.command),
    family: task.options?.rootSession || task.options?.sessionNameHistory?.[0] || task.options?.sessionName,
    startedAt: Date.parse(task.attempt?.startedAt || task.options?.resumedAt || task.startTime),
  };
}

function recoveryPlan(executions, containers, limit) {
  const tasks = executions.map(taskFacts).filter(({ target, startedAt }) => target && Number.isFinite(startedAt));
  tasks.sort((a, b) => b.startedAt - a.startedAt);
  const busyTargets = new Set();
  for (const { task, target, family } of tasks) {
    const active = containers.some(container => container.uuid === task.uuid || (family && (container.family === family || container.name === family || container.name.startsWith(`${family}-resume-`))));
    if (active || task.status === 'executing' || task.paused === true) busyTargets.add(target);
  }
  const checked = new Set();
  const candidates = [];
  for (const { task, target, family } of tasks) {
    if (checked.has(target) || busyTargets.has(target)) continue;
    checked.add(target);
    const { uuid, status, exitCode, options } = task;
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(uuid ?? '') || status !== 'executed' || !Number.isInteger(exitCode) || exitCode <= 0) continue;
    if (!family || options?.isolated !== 'docker' || options.isolationMode !== 'detached' || (options.resumeCount ?? 0) !== 0 || (task.attempt?.number ?? 1) !== 1) continue;
    if (task.oomKilled !== true && task.memoryExhausted !== true) continue;
    candidates.push({ id: uuid, exitCode, finishedAt: task.endTime ?? null });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

async function currentPlan(limit) {
  const executions = await listTrackedTasks();
  let stdout;
  try {
    ({ stdout } = await execFileAsync('docker', ['ps', '--format', '{{.Names}}\t{{.Label "start-command.root-session"}}\t{{.Label "start-command.uuid"}}'], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }));
  } catch {
    throw new Error('Could not inspect running Docker tasks. Check access to the task daemon.');
  }
  const containers = stdout
    .trimEnd()
    .split('\n')
    .map(line => {
      const [name, family, uuid] = line.split('\t');
      return { name, family, uuid };
    });
  return recoveryPlan(executions, containers, limit);
}

async function followRecoveries(outcomes, seconds) {
  const pending = new Set(outcomes.filter(outcome => outcome.state === 'resumed'));
  const deadline = performance.now() + seconds * 1000;
  while (pending.size && performance.now() < deadline) {
    try {
      const tasks = await listTrackedTasks(Math.max(1, Math.ceil(deadline - performance.now())));
      const byId = new Map(tasks.map(task => [task.uuid, task]));
      for (const outcome of pending) {
        const task = byId.get(outcome.id);
        const attempt = task && taskAttempts(task).get(2);
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

async function recoverFailed() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, limit: { type: 'string', default: '3' }, apply: { type: 'boolean' }, wait: { type: 'string' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const limit = Number(values.limit);
  if (!/^\d+$/.test(values.limit) || limit < 1 || limit > 10) throw new Error('Recovery limit must be between 1 and 10.');
  const wait = Number(values.wait);
  if (values.wait !== undefined && (!values.apply || !/^\d+$/.test(values.wait) || wait < 1 || wait > 3600)) throw new Error('--wait requires --apply and between 1 and 3600 seconds.');
  const action = async () => {
    const candidates = await currentPlan(limit);
    const outcomes = [];
    if (values.apply) {
      for (const candidate of candidates) {
        // Recheck immediately before using start-command's own launch guard.
        const current = (await currentPlan(limit)).find(task => task.id === candidate.id);
        if (!current) {
          outcomes.push({ id: candidate.id, state: 'changed' });
          continue;
        }
        try {
          await execFileAsync('$', ['--resume', candidate.id, '--output-format', 'json'], { timeout: 120_000, maxBuffer: 1024 * 1024 });
          outcomes.push({ id: candidate.id, state: 'resumed' });
        } catch {
          outcomes.push({ id: candidate.id, state: 'resume-failed' });
          break;
        }
      }
    }
    return { mode: values.apply ? 'apply' : 'preview', candidates, outcomes };
  };
  const result = values.apply ? await withStateLock('hive-manager-task-recovery', action, { timeoutMs: 5000, staleMs: 60 * 60 * 1000 }) : await action();
  if (wait) await followRecoveries(result.outcomes, wait);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.outcomes.some(({ state }) => state === 'resume-failed')) throw new Error('A resume could not be confirmed. Check tasks status before retrying.');
  if (wait && result.outcomes.some(({ state, completion }) => state === 'resumed' && completion?.exitCode !== 0)) process.exitCode = 1;
}

try {
  await recoverFailed();
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
