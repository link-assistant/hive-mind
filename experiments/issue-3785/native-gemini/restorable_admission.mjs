// Bind the actual terminal history writer to native edit and dispatch paths.
import { nativeGeminiHistorySelected } from './hive-gemini-history.mjs';
import { readNativeGeminiRestorableHistory } from './hive-gemini-restorable-history.mjs';

const bindings = new WeakMap();
const writers = new WeakMap();
const pending = new WeakMap();
let failed = false;
const refuse = () => {
  failed = true;
  return new Error('Gemini canonical conversation history is unavailable or unsafe.');
};

export function registerNativeGeminiRestorableAdmission(storage, schema) {
  if (!nativeGeminiHistorySelected()) return;
  try {
    if (failed) throw refuse();
    readNativeGeminiRestorableHistory(storage, schema);
    bindings.set(storage, schema);
  } catch {
    throw refuse();
  }
}

export function registerNativeGeminiRestorableWriter(config, writer) {
  if (!nativeGeminiHistorySelected() || !config.getCheckpointingEnabled()) return;
  // Registration only refreshes the React closure. It never starts a write.
  writers.set(config.storage, writer);
}

export function assertNativeGeminiRestorableAdmission(config) {
  if (!nativeGeminiHistorySelected()) return;
  try {
    if (failed) throw refuse();
    const schema = bindings.get(config?.storage);
    if (schema) readNativeGeminiRestorableHistory(config.storage, schema);
  } catch {
    throw refuse();
  }
}

export async function prepareNativeGeminiRestorableEdit(config, request) {
  if (!nativeGeminiHistorySelected()) return;
  assertNativeGeminiRestorableAdmission(config);
  const storage = config?.storage;
  const writer = writers.get(storage);
  if (!writer || !['write_file', 'replace'].includes(request.name)) return;
  try {
    if (!bindings.has(storage)) throw refuse();
    // A batch may approve several edits together. Each complete native snapshot
    // and its metadata must be acknowledged before the next writer proceeds.
    const previous = pending.get(storage);
    const operation = (async () => {
      if (previous) await previous;
      assertNativeGeminiRestorableAdmission(config);
      await writer(request);
      assertNativeGeminiRestorableAdmission(config);
    })();
    pending.set(storage, operation);
    try {
      await operation;
    } finally {
      if (pending.get(storage) === operation) pending.delete(storage);
    }
  } catch {
    throw refuse();
  }
}
