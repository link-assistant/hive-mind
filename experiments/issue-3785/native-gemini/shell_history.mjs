// Checked command data for the inspected native interactive shell-history hook.
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { appendNativeGeminiPromptHistory, readNativeGeminiPromptHistory, assertNativeGeminiHistoryCurrent, nativeGeminiHistorySelected } from './hive-gemini-history.mjs';

const paths = new Map();
const sessionId = 'hive-native-shell-command-audit';
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

export function registerNativeGeminiShellHistory(temporary, file) {
  if (!nativeGeminiHistorySelected()) return file;
  return checked(() => {
    if (typeof temporary !== 'string' || typeof file !== 'string' || !path.isAbsolute(temporary) || path.normalize(temporary) !== temporary || file !== path.join(temporary, 'shell_history') || /[\0\r\n]/u.test(file) || (paths.has(file) && paths.get(file) !== temporary) || (!paths.has(file) && paths.size >= 64)) throw refuse();
    // The native path is only a registered selector. Selected reads/writes never
    // open that private file; the existing checked prompt transaction owns data.
    readNativeGeminiPromptHistory(temporary);
    paths.set(file, temporary);
    return file;
  });
}

function selected(file) {
  const temporary = paths.get(file);
  if (!temporary) throw refuse();
  return temporary;
}

function validCommand(command) {
  return typeof command === 'string' && command.trim().length > 0 && Buffer.byteLength(command) <= 1024 * 1024 && !command.includes('\0') && Buffer.from(command).toString('utf8') === command;
}

function validateCommands(records) {
  for (const entry of records) {
    if (entry.type === 'shell-command' && (entry.sessionId !== sessionId || !validCommand(entry.message))) throw refuse();
  }
}

function recent(records) {
  validateCommands(records);
  const commands = [];
  const seen = new Set();
  for (let index = records.length - 1; index >= 0 && commands.length < 100; index--) {
    const entry = records[index];
    if (entry.type !== 'shell-command' || entry.sessionId !== sessionId || seen.has(entry.message)) continue;
    commands.push(entry.message);
    seen.add(entry.message);
  }
  return commands.reverse();
}

export function readNativeGeminiShellHistory(file) {
  if (!nativeGeminiHistorySelected()) return undefined;
  return checked(() => recent(readNativeGeminiPromptHistory(selected(file))));
}

export function appendNativeGeminiShellHistory(file, command) {
  if (!nativeGeminiHistorySelected()) return undefined;
  return checked(() => {
    const temporary = selected(file);
    if (typeof command !== 'string') throw refuse();
    if (!command.trim()) return recent(readNativeGeminiPromptHistory(temporary));
    if (!validCommand(command)) throw refuse();
    const entry = { sessionId, messageId: 0, type: 'shell-command', message: command, timestamp: new Date().toISOString() };
    return recent(appendNativeGeminiPromptHistory(temporary, entry, validateCommands).logs);
  });
}

export function refuseNativeGeminiShellRewrite() {
  throw refuse();
}
