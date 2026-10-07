// Protect argv before importing dependencies: process.argv assignments do not
// change Linux /proc/<pid>/cmdline. execve also avoids a leaking parent process.
import { readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';

const TRANSPORT_KEY = 'HIVE_MIND_TELEGRAM_ARGV_OPTIONS';
const INLINE_FLAGS = new Map([
  ['--configuration', 'configuration'],
  ['-c', 'configuration'],
  ['--token', 'token'],
  ['-t', 'token'],
]);

export function extractTelegramInlineOptions(argv) {
  const args = [];
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') {
      args.push(...argv.slice(index));
      break;
    }
    const equals = arg.indexOf('=');
    const flag = equals < 0 ? arg : arg.slice(0, equals);
    let key = INLINE_FLAGS.get(flag);
    let value = equals < 0 ? undefined : arg.slice(equals + 1);
    const grouped = !key && arg.match(/^-([vh]*)([ct])(.*)$/s);
    if (grouped) {
      for (const alias of grouped[1]) args.push(`-${alias}`);
      key = INLINE_FLAGS.get(`-${grouped[2]}`);
      value = grouped[3] || undefined;
      if (value?.startsWith('=')) value = value.slice(1);
    }
    if (!key) {
      args.push(arg);
      continue;
    }
    if (value === undefined) {
      value = argv[++index];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Inline configuration/token requires a value; use --configuration-file or environment variables.');
      }
    }
    options[key] = value;
  }
  return { args, options };
}

export function secureTelegramArgv({ argv = process.argv, execArgv = process.execArgv, env = process.env, execPath = process.execPath, execve = process.execve } = {}) {
  const transported = env[TRANSPORT_KEY];
  delete env[TRANSPORT_KEY];
  let previous = {};
  if (transported) {
    try {
      previous = JSON.parse(transported);
      if (!previous || typeof previous !== 'object' || Array.isArray(previous) || Object.values(previous).some(value => typeof value !== 'string')) throw new Error();
    } catch {
      throw new Error('Invalid protected Telegram startup configuration.');
    }
  }
  const { args, options } = extractTelegramInlineOptions(argv.slice(2));
  if (Object.keys(options).length === 0) return previous;
  if (typeof execve !== 'function') {
    throw new Error('This runtime cannot safely replace secret-bearing arguments. Use --configuration-file, .lenv/.env, or environment variables.');
  }
  // Synchronous output survives execve; no exit handlers or async writes run.
  writeSync(2, 'Warning: Inline configuration/token can expose secrets in process listings. Replacing process arguments; use --configuration-file or environment variables.\n');
  try {
    execve(execPath, [execPath, ...execArgv, argv[1], ...args], { ...env, [TRANSPORT_KEY]: JSON.stringify({ ...previous, ...options }) });
  } catch {
    // Node errors can contain argv or env data. Never forward their text.
    throw new Error('Unable to replace secret-bearing arguments. Restart using --configuration-file or environment variables.');
  }
  throw new Error('Process replacement returned unexpectedly.');
}

function configurationFileFromArgs(argv) {
  let path;
  for (let index = 0; index < argv.length && argv[index] !== '--'; index++) {
    const arg = argv[index];
    if (arg === '--configuration-file' || arg === '--configurationFile') {
      path = argv[++index];
      if (!path || path.startsWith('--')) throw new Error('--configuration-file requires a path.');
    } else if (arg.startsWith('--configuration-file=') || arg.startsWith('--configurationFile=')) {
      path = arg.slice(arg.indexOf('=') + 1);
      if (!path) throw new Error('--configuration-file requires a path.');
    }
  }
  return path;
}

// Called after dotenv/.lenv but before creating the CLI parser, so all defaults
// (including booleans and isolation) reflect the selected configuration.
export async function loadTelegramStartupConfig({ loadLenvConfig, inlineOptions = {}, argv = process.argv.slice(2), env = process.env } = {}) {
  const path = configurationFileFromArgs(argv) ?? env.HIVE_MIND_CONFIGURATION_FILE;
  if (env.TELEGRAM_CONFIGURATION) await loadLenvConfig({ configuration: env.TELEGRAM_CONFIGURATION, override: true, quiet: true });
  if (path) {
    let content;
    try {
      content = await readFile(path, 'utf8');
    } catch {
      throw new Error('Unable to read --configuration-file / HIVE_MIND_CONFIGURATION_FILE. Check the path and file permissions.');
    }
    await loadLenvConfig({ configuration: content, override: true, quiet: true });
  }
  if (inlineOptions.configuration) await loadLenvConfig({ configuration: inlineOptions.configuration, override: true, quiet: true });
  if (inlineOptions.token !== undefined) env.TELEGRAM_BOT_TOKEN = inlineOptions.token;
}
