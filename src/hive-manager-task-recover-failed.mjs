import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';
import { listTrackedTasks } from './hive-manager-task-report.mjs';

const execFileAsync = promisify(execFile);
const usage = `Usage: hive-manager tasks recover-failed [--limit NUMBER] [--apply]
Plan recovery of detached Hive Mind Docker tasks with out-of-memory evidence.
Only --apply resumes eligible tasks. Tasks with recorded retries are skipped.
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
    if (!family || options?.isolated !== 'docker' || options.isolationMode !== 'detached' || (options.resumeCount ?? 0) !== 0) continue;
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

async function recoverFailed() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, limit: { type: 'string', default: '3' }, apply: { type: 'boolean' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const limit = Number(values.limit);
  if (!/^\d+$/.test(values.limit) || limit < 1 || limit > 10) throw new Error('Recovery limit must be between 1 and 10.');
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
    process.stdout.write(`${JSON.stringify({ mode: values.apply ? 'apply' : 'preview', candidates, outcomes }, null, 2)}\n`);
    if (outcomes.some(({ state }) => state === 'resume-failed')) throw new Error('A resume could not be confirmed. Check tasks status before retrying.');
  };
  if (values.apply) await withStateLock('hive-manager-task-recovery', action, { timeoutMs: 5000, staleMs: 60 * 60 * 1000 });
  else await action();
}

try {
  await recoverFailed();
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
