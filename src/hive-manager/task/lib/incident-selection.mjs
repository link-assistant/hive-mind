import { isFailedAttempt, taskAttempts, taskBackend, taskUuidPattern, timestamp, validateTaskUuid } from './inspection.mjs';
import { validateHostSignature } from './incident-routes.mjs';

export const maxIncidents = 100;

export function positiveAttempt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function recordedVersion(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 64 || !/^v?\d+\.\d+\.\d+(?:-[a-z\d.-]+)?(?:\+[a-z\d.-]+)?$/i.test(value)) {
    throw new Error('Specify the Hive Mind release version recorded for the selected attempts.');
  }
  return value.replace(/^v/i, '');
}

function savedTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || timestamp(value) === 'Unknown') {
    throw new Error('Use explicit ISO timestamps with time zones for the saved window.');
  }
  return timestamp(value);
}

export function normalizeSelection(selection) {
  const { attempts, window, executions, installedVersion, limit = 20 } = selection ?? {};
  if ((attempts === undefined) === (window === undefined)) throw new Error('Select a saved time window or one or more exact execution attempts.');
  if (!positiveAttempt(limit) || limit > maxIncidents) throw new Error(`The incident batch limit must be between 1 and ${maxIncidents}.`);
  const version = recordedVersion(installedVersion);
  if (attempts !== undefined) {
    if (executions !== undefined || !Array.isArray(attempts) || attempts.length === 0 || attempts.length > limit) throw new Error('Supply exact attempts within the batch limit.');
    const exact = new Map();
    for (const selection of attempts) {
      const { uuid, attempt, installedVersion, hostSignature } = selection ?? {};
      validateTaskUuid(uuid);
      if (!positiveAttempt(attempt)) throw new Error('Select each execution with its positive attempt number.');
      const entry = { uuid: uuid.toLowerCase(), attempt, installedVersion: recordedVersion(installedVersion), hostSignature };
      const key = `${entry.uuid}#${attempt}`;
      const previous = exact.get(key);
      if (previous && (previous.installedVersion !== entry.installedVersion || previous.hostSignature !== hostSignature)) throw new Error('Conflicting review metadata for the same execution attempt.');
      exact.set(key, entry);
    }
    return { attempts: [...exact.values()], limit, installedVersion: version };
  }
  const from = savedTime(window?.from);
  const to = savedTime(window?.to);
  if (from >= to) throw new Error('The incident time window must end after it starts.');
  if (executions !== undefined && (!Array.isArray(executions) || !executions.length || executions.length > maxIncidents)) throw new Error('Supply a bounded list of execution UUIDs for the window.');
  const ids = executions?.map(uuid => {
    validateTaskUuid(uuid);
    return uuid.toLowerCase();
  });
  return { window: { from, to }, executions: ids && [...new Set(ids)], limit, installedVersion: version };
}

export function selectIncidents(tasks, selection) {
  if (!Array.isArray(tasks)) throw new Error('Supply an array of saved execution records.');
  const ids = selection.attempts?.map(entry => entry.uuid) ?? selection.executions;
  const wanted = ids && new Set(ids);
  const byId = new Map();
  for (const task of tasks) {
    const id = typeof task?.uuid === 'string' && taskUuidPattern.test(task.uuid) ? task.uuid.toLowerCase() : null;
    if (!id || (wanted && !wanted.has(id))) continue;
    if (byId.has(id)) throw new Error('Saved records contain a duplicate execution UUID.');
    byId.set(id, task);
  }
  if (wanted && [...wanted].some(id => !byId.has(id))) throw new Error('A selected execution UUID is missing from the saved records.');

  const entries = [];
  const add = (id, task, attempts, attempt, version, hostSignature) => {
    if (entries.length === selection.limit) throw new Error('The saved window exceeds the batch limit. Narrow the window or select exact attempts.');
    validateHostSignature(hostSignature, taskBackend(task), attempt.exitCode);
    entries.push({ id, task, attempts, attempt, installedVersion: version ?? selection.installedVersion, hostSignature });
  };
  if (selection.attempts) {
    const attemptsById = new Map();
    for (const entry of selection.attempts) {
      const task = byId.get(entry.uuid);
      if (!attemptsById.has(entry.uuid)) attemptsById.set(entry.uuid, taskAttempts(task));
      const attempts = attemptsById.get(entry.uuid);
      const attempt = attempts.get(entry.attempt);
      if (!isFailedAttempt(attempt)) throw new Error('A selected attempt has no confirmed failed exit.');
      add(entry.uuid, task, attempts, attempt, entry.installedVersion, entry.hostSignature);
    }
  } else {
    for (const [id, task] of byId) {
      const attempts = taskAttempts(task);
      for (const attempt of attempts.values()) {
        if (!positiveAttempt(attempt.number) || !isFailedAttempt(attempt)) continue;
        const finishedAt = timestamp(attempt.endTime ?? attempt.finishedAt);
        if (finishedAt >= selection.window.from && finishedAt < selection.window.to) add(id, task, attempts, attempt);
      }
    }
    entries.sort((left, right) => {
      const finished = entry => timestamp(entry.attempt.endTime ?? entry.attempt.finishedAt);
      return finished(left).localeCompare(finished(right)) || left.id.localeCompare(right.id) || left.attempt.number - right.attempt.number;
    });
  }
  return entries;
}
