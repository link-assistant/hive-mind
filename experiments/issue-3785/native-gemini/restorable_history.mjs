// Data-only native tool restore metadata. Executable configuration stays private.
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { nativeGeminiHistorySelected, assertNativeGeminiHistoryCurrent, readNativeGeminiPromptHistory, appendNativeGeminiPromptHistory } from './hive-gemini-history.mjs';

const bindings = new WeakMap();
const sessionId = 'hive-native-restorable-tools';
let failed = false;
const refuse = () => {
  if (!failed && process.env.GEMINI_HISTORY_DEBUG === '1') {
    const locations = new Error().stack?.match(/restorable[-_]history\.mjs:[0-9]+:[0-9]+/gu) ?? [];
    process.stderr.write(`Gemini restorable history refused at ${locations.slice(0, 8).join(', ')}.\n`);
  }
  failed = true;
  return new Error('Gemini canonical conversation history is unavailable or unsafe.');
};

function checked(action) {
  try {
    if (failed) throw refuse();
    assertNativeGeminiHistoryCurrent();
    return action();
  } catch {
    throw refuse();
  }
}

function temporary(storage) {
  const value = storage.getProjectTempDir();
  const previous = bindings.get(storage);
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value || (previous && previous !== value)) throw refuse();
  bindings.set(storage, value);
  return value;
}

function validName(name) {
  return typeof name === 'string' && Buffer.byteLength(name) <= 1024 && name === path.basename(name) && !/[\\\0\r\n]/u.test(name) && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_\d{3}Z-.+-(?:write_file|replace)\.json$/u.test(name);
}

function checkpoints(records, schema) {
  const result = new Map();
  const heads = new Set();
  for (const record of records) {
    if (record.type !== 'git-checkpoint') continue;
    if (record.sessionId !== 'hive-native-git-checkpoints' || !/^[a-f0-9]{40}$/u.test(record.message)) throw refuse();
    heads.add(record.message);
  }
  for (const record of records) {
    if (record.type !== 'restorable-tool') continue;
    if (record.sessionId !== sessionId || Buffer.byteLength(record.message) > 4 * 1024 * 1024) throw refuse();
    const saved = JSON.parse(record.message);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).sort().join(',') !== 'content,name' || !validName(saved.name) || typeof saved.content !== 'string') throw refuse();
    const parsed = schema.parse(JSON.parse(saved.content));
    if (!/^[a-f0-9]{40}$/u.test(parsed.commitHash) || !heads.has(parsed.commitHash) || !['write_file', 'replace'].includes(parsed.toolCall.name) || typeof parsed.toolCall.args.file_path !== 'string' || !parsed.toolCall.args.file_path || !saved.name.endsWith('-' + path.basename(parsed.toolCall.args.file_path) + '-' + parsed.toolCall.name + '.json')) throw refuse();
    result.set(saved.name, { content: saved.content, data: parsed });
  }
  return result;
}

export function readNativeGeminiRestorableHistory(storage, schema) {
  if (!nativeGeminiHistorySelected()) return undefined;
  return checked(() => checkpoints(readNativeGeminiPromptHistory(temporary(storage)), schema));
}

export function saveNativeGeminiRestorableHistory(storage, name, content, schema) {
  if (!nativeGeminiHistorySelected()) return;
  return checked(() => {
    const location = temporary(storage);
    const entry = { sessionId, messageId: 0, type: 'restorable-tool', message: JSON.stringify({ name, content }), timestamp: new Date().toISOString() };
    if (Buffer.byteLength(entry.message) > 4 * 1024 * 1024) throw refuse();
    appendNativeGeminiPromptHistory(location, entry, records => checkpoints([...records, entry], schema));
  });
}

export function assertNativeGeminiRestorableRestore(storage, data, schema) {
  if (!nativeGeminiHistorySelected()) return;
  checked(() => {
    const expected = JSON.stringify(data);
    const saved = readNativeGeminiRestorableHistory(storage, schema);
    if (![...saved.values()].some(value => JSON.stringify(value.data) === expected)) throw refuse();
  });
}
