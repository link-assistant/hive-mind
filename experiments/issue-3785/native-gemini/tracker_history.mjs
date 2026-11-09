// Checked tracker data for the inspected native service. No executable state.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { appendNativeGeminiPromptHistory, readNativeGeminiPromptHistory, assertNativeGeminiHistoryCurrent, nativeGeminiHistorySelected } from './hive-gemini-history.mjs';

const paths = new Map();
const services = new WeakMap();
const reads = new WeakMap();
const prefix = 'hive-native-tracker:';
let failed = false;
const refuse = () => {
  failed = true;
  return new Error('Gemini canonical conversation history is unavailable or unsafe.');
};

function checked(operation) {
  try {
    if (failed) throw refuse();
    assertNativeGeminiHistoryCurrent();
    return operation();
  } catch {
    throw refuse();
  }
}

export function registerNativeGeminiTracker(temporary, session, file) {
  if (!nativeGeminiHistorySelected()) return file;
  return checked(() => {
    const namespace = session ?? '';
    if (typeof temporary !== 'string' || !path.isAbsolute(temporary) || path.normalize(temporary) !== temporary || /[\0\r\n]/u.test(temporary) || typeof namespace !== 'string' || Buffer.byteLength(namespace) > 4096 || (namespace !== '' && !/^[A-Za-z0-9_-]+$/u.test(namespace)) || file !== path.join(temporary, ...(namespace ? [namespace] : []), 'tracker')) throw refuse();
    const scope = prefix + createHash('sha256').update(namespace).digest('hex');
    const previous = paths.get(file);
    if ((previous && (previous.temporary !== temporary || previous.scope !== scope)) || (!previous && paths.size >= 64)) throw refuse();
    readNativeGeminiPromptHistory(temporary);
    paths.set(file, { temporary, scope });
    return file;
  });
}

function binding(service) {
  const current = paths.get(service.tasksDir);
  if (!current || service.trackerDir !== service.tasksDir) throw refuse();
  const previous = services.get(service);
  if (previous && (previous.file !== service.tasksDir || previous.context.temporary !== current.temporary || previous.context.scope !== current.scope)) throw refuse();
  if (!previous) services.set(service, { file: service.tasksDir, context: current });
  return current;
}

function tasks(records, context, schema) {
  const result = new Map();
  for (const entry of records) {
    if (entry.type !== 'tracker-task') continue;
    if (!/^hive-native-tracker:[a-f0-9]{64}$/u.test(entry.sessionId) || Buffer.byteLength(entry.message) > 1024 * 1024) throw refuse();
    const task = schema.parse(JSON.parse(entry.message));
    if (entry.sessionId === context.scope) result.set(task.id, { task, revision: entry.messageId });
  }
  return result;
}

function loaded(service, schema) {
  const context = binding(service);
  return { context, tasks: tasks(readNativeGeminiPromptHistory(context.temporary), context, schema) };
}

export function initializeNativeGeminiTracker(service, schema) {
  return checked(() => {
    loaded(service, schema);
  });
}

export function readNativeGeminiTracker(service, id, schema) {
  return checked(() => {
    if (typeof id !== 'string' || id.length > 4096 || id.includes('\0')) throw refuse();
    const { context, tasks } = loaded(service, schema);
    const item = tasks.get(id);
    if (!item) return null;
    reads.set(item.task, { scope: context.scope, temporary: context.temporary, id, revision: item.revision });
    return item.task;
  });
}

export function listNativeGeminiTracker(service, schema) {
  return checked(() => {
    const { context, tasks } = loaded(service, schema);
    return [...tasks.values()].map(item => {
      reads.set(item.task, { scope: context.scope, temporary: context.temporary, id: item.task.id, revision: item.revision });
      return item.task;
    });
  });
}

export function readNativeGeminiTrackerFile(service, file, schema) {
  return checked(() => {
    binding(service);
    if (typeof file !== 'string' || path.normalize(file) !== file || path.dirname(file) !== service.tasksDir || !file.endsWith('.json')) throw refuse();
    return readNativeGeminiTracker(service, path.basename(file, '.json'), schema);
  });
}

export function saveNativeGeminiTracker(service, task, schema, expectedTask, creating) {
  return checked(() => {
    const context = binding(service);
    schema.parse(task);
    const message = JSON.stringify(task);
    if (Buffer.byteLength(message) > 1024 * 1024) throw refuse();
    const expected = reads.get(expectedTask ?? task);
    if (expectedTask !== undefined && !expected) throw refuse();
    const validate = records => {
      const current = tasks(records, context, schema).get(task.id);
      if (creating && current) throw refuse();
      if (expected && (expected.scope !== context.scope || expected.temporary !== context.temporary || expected.id !== task.id || current?.revision !== expected.revision)) throw refuse();
    };
    appendNativeGeminiPromptHistory(context.temporary, { sessionId: context.scope, messageId: 0, type: 'tracker-task', message, timestamp: new Date().toISOString() }, validate);
  });
}
