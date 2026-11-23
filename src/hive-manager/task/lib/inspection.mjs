import { HiveManagerError } from '../../lib/error.mjs';
import { classifyTaskFailure } from '../../../task-failure-signature.lib.mjs';
import { readAttemptEvidence, summarizeTaskEvidence } from './evidence.mjs';

export const taskUuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function validateTaskUuid(uuid) {
  if (typeof uuid !== 'string' || !taskUuidPattern.test(uuid)) throw new HiveManagerError('INVALID_INPUT', 'Use the complete execution UUID.');
}

export function validateReportLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new HiveManagerError('INVALID_INPUT', 'Report limit must be between 1 and 1000.');
}

export function selectTask(tasks, uuid) {
  validateTaskUuid(uuid);
  const task = tasks.find(entry => entry.uuid === uuid.toLowerCase());
  if (!task) throw new HiveManagerError('TASK_NOT_FOUND', 'No tracked execution matches that UUID.');
  return task;
}

function selectAttempt(tasks, { uuid, attempt }) {
  if (attempt !== undefined && (!Number.isSafeInteger(attempt) || attempt < 1)) throw new HiveManagerError('INVALID_INPUT', 'Use a positive attempt number.');
  const task = selectTask(tasks, uuid);
  const attempts = taskAttempts(task);
  const entry = attempts.get(attempt ?? latestAttempt(task));
  return { task, attempts, entry };
}

export function timestamp(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : 'Unknown';
}

export function failureKind({ exitCode, oomKilled, memoryExhausted }) {
  if (oomKilled === true || memoryExhausted === true) return 'Memory exhaustion';
  if (exitCode === 127) return 'Command unavailable (exit 127)';
  if (exitCode >= 128) return 'Signal-range exit code';
  return 'Nonzero exit code';
}

export function taskBackend(task) {
  const backend = task.options?.isolated;
  return ['docker', 'screen', 'tmux', 'ssh'].includes(backend) ? backend : 'local';
}

export function latestAttempt(task) {
  return task.attempt?.number ?? (Number(task.options?.resumeCount) || 0) + (Number(task.options?.recoveryAttempts) || 0) + 1;
}

export function taskAttempts(task) {
  const number = latestAttempt(task);
  const history = Array.isArray(task.attemptHistory) ? task.attemptHistory : [];
  const attempts = new Map(history.filter(attempt => Number.isSafeInteger(attempt?.number) && attempt.number > 0).map(attempt => [attempt.number, attempt]));
  attempts.set(number, { ...task, number, startedAt: task.attempt?.startedAt ?? task.startTime, logOffset: task.attempt?.logOffset });
  return attempts;
}

function readSelectedAttempt(task, attempts, attempt, maxBytes) {
  const next = attempts.get(attempt.number + 1);
  const offset = (value, fallback) => (Number.isSafeInteger(value) && value >= 0 ? value : fallback);
  const start = offset(attempt.logOffset, attempt.number === 1 ? 0 : null);
  const end = offset(next?.logOffset, attempt.number === latestAttempt(task) ? Infinity : null);
  return readAttemptEvidence(task.logPath, start, end, maxBytes);
}

export async function attemptEvidence(task, attempts, attempt) {
  return summarizeTaskEvidence(await readSelectedAttempt(task, attempts, attempt), attempt);
}

function* failedAttempts(tasks) {
  for (const task of tasks) {
    const attempts = taskAttempts(task);
    for (const attempt of attempts.values()) {
      if (attempt.status !== 'executed' || !Number.isSafeInteger(attempt.exitCode) || attempt.exitCode <= 0) continue;
      yield { task, attempts, attempt };
    }
  }
}

function addFailureGroup(groups, task, attempt, signature) {
  const backend = taskBackend(task);
  const kind = failureKind(attempt);
  const exitCode = attempt.exitCode;
  const key = `${backend}:${kind}:${exitCode}:${signature ?? ''}`;
  const group = groups.get(key) ?? { backend, kind, exitCode, count: 0, latest: null };
  if (signature !== undefined) group.signature = signature;
  group.count++;
  const finishedAt = timestamp(attempt.endTime ?? attempt.finishedAt);
  if (!group.latest || (finishedAt !== 'Unknown' && (group.latest.finishedAt === 'Unknown' || finishedAt > group.latest.finishedAt))) {
    group.latest = { id: task.uuid, attempt: attempt.number, finishedAt };
  }
  groups.set(key, group);
}

function sortedGroups(groups, limit) {
  return { groups: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit) };
}

export function inspectTasks(tasks, { limit = 25 } = {}) {
  validateReportLimit(limit);
  const counts = { running: 0, paused: 0, succeeded: 0, failed: 0, unknown: 0 };
  const failures = [];
  for (const task of tasks) {
    if (task.status === 'executing') {
      counts[task.paused === true ? 'paused' : 'running']++;
    } else if (task.status === 'executed' && task.exitCode === 0) {
      counts.succeeded++;
    } else if (task.status === 'failed' || (task.status === 'executed' && Number.isInteger(task.exitCode))) {
      counts.failed++;
      if (failures.length < limit) {
        failures.push({
          id: task.uuid,
          exitCode: task.exitCode ?? null,
          finishedAt: task.endTime ?? null,
          memoryExhausted: task.memoryExhausted === true || task.oomKilled === true,
          reason: task.exitReason ?? null,
        });
      }
    } else {
      counts.unknown++;
    }
  }
  return { counts, failures };
}

export function groupTaskFailures(tasks, { limit = 25 } = {}) {
  validateReportLimit(limit);
  const groups = new Map();
  for (const { task, attempt } of failedAttempts(tasks)) addFailureGroup(groups, task, attempt);
  return sortedGroups(groups, limit);
}

export async function groupTaskFailuresBySignature(tasks, { limit = 25 } = {}) {
  validateReportLimit(limit);
  const groups = new Map();
  // Read one bounded log tail at a time. The result never contains log lines.
  for (const { task, attempts, attempt } of failedAttempts(tasks)) {
    const { text } = await readSelectedAttempt(task, attempts, attempt, 512 * 1024);
    addFailureGroup(groups, task, attempt, classifyTaskFailure(attempt, text));
  }
  return sortedGroups(groups, limit);
}

export function inspectTaskWindow(tasks, selection) {
  const { entry } = selectAttempt(tasks, selection);
  const startedAt = timestamp(entry?.startedAt);
  const finishedAt = timestamp(entry?.endTime ?? entry?.finishedAt);
  if (startedAt === 'Unknown' || (finishedAt === 'Unknown' && entry?.status !== 'executing') || (finishedAt !== 'Unknown' && finishedAt < startedAt)) {
    throw new HiveManagerError('TASK_WINDOW_UNAVAILABLE', 'The selected attempt has no usable time window.');
  }
  return { startedAt, finishedAt: finishedAt === 'Unknown' ? null : finishedAt };
}

export async function collectTaskEvidence(tasks, selection) {
  const { task, attempts, entry } = selectAttempt(tasks, selection);
  if (!entry) throw new HiveManagerError('ATTEMPT_NOT_FOUND', 'No recorded attempt has the selected number.');
  const evidence = await attemptEvidence(task, attempts, entry);
  return { id: task.uuid, attempt: entry.number, status: entry.status, exitCode: entry.exitCode ?? null, startedAt: timestamp(entry.startedAt), finishedAt: timestamp(entry.endTime ?? entry.finishedAt), evidence };
}
