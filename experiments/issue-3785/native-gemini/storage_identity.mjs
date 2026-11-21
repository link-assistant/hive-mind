// Compare native authorities with identities admitted before container launch.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const selections = new Map();
const names = new Map([
  ['auth', ['GEMINI_AUTH_HOME', 'HIVE_MIND_GEMINI_AUTH_IDENTITY', 'authentication']],
  ['history', ['GEMINI_HISTORY_HOME', 'HIVE_MIND_GEMINI_HISTORY_IDENTITY', 'conversation history']],
]);

export function nativeGeminiStorageSelected(kind) {
  const [selector, marker] = names.get(kind);
  return selections.has(kind) || process.env[selector] !== undefined || process.env[marker] !== undefined;
}

export function assertNativeGeminiStorageIdentity(kind) {
  const [selector, marker, label] = names.get(kind);
  const refused = () => new Error(`Gemini canonical ${label} is unavailable or unsafe.`);
  try {
    const directory = process.env[selector];
    const expected = process.env[marker];
    if (process.platform !== 'linux' || typeof directory !== 'string' || !path.isAbsolute(directory) || directory === path.parse(directory).root || path.normalize(directory) !== directory || /[\0\r\n]/u.test(directory) || fs.realpathSync(directory) !== directory) throw refused();
    const info = fs.lstatSync(directory, { bigint: true });
    if (!info.isDirectory() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o077n) !== 0n) throw refused();
    const identity = `${info.dev}:${info.ino}`;
    if (expected !== undefined && (!/^[0-9]{1,20}:[0-9]{1,20}$/u.test(expected) || expected !== identity)) throw refused();
    const retained = selections.get(kind);
    if (retained && (retained.directory !== directory || retained.expected !== expected || retained.identity !== identity)) throw refused();
    if (!retained) selections.set(kind, { directory, expected, identity });
  } catch {
    throw refused();
  }
}
