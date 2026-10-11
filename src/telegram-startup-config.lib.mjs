// Inline secrets on argv are allowed but discouraged (issue #2647): /proc/<pid>/cmdline
// is world-readable, and process.argv assignments do not change it. Warn, recommend
// .lenv or a Links Notation file, and re-exec without them when the runtime can.
import { readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';

const TRANSPORT_KEY = 'HIVE_MIND_TELEGRAM_ARGV_OPTIONS';
const INLINE_FLAGS = new Map([
  ['--configuration', 'configuration'],
  ['-c', 'configuration'],
  ['--token', 'token'],
  ['-t', 'token'],
]);
// Matches LINO keys such as TELEGRAM_BOT_TOKEN, GITHUB_TOKEN, API_KEY or CLIENT_SECRET.
const SECRET_KEY_PATTERN = /^\s*['"]?([\w.-]*(?:token|secret|password|passphrase|credential|api[_-]?key|[_-]key)[\w.-]*)['"]?\s*:/im;

export const INLINE_SECRET_WARNING = 'Warning: secrets passed with --token/-t or --configuration/-c are visible to every user and process on this host (ps, /proc/<pid>/cmdline). Recommended: put them in a private .lenv file (chmod 600) in the working directory, or in a Links Notation file loaded with --configuration-file <path> (or HIVE_MIND_CONFIGURATION_FILE).';

export function containsInlineSecret(options) {
  return Boolean(options.token) || SECRET_KEY_PATTERN.test(options.configuration ?? '');
}

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
      key = INLINE_FLAGS.get(`-${grouped[2]}`);
      value = grouped[3] || undefined;
      if (value?.startsWith('=')) value = value.slice(1);
    }
    // Leave a flag without a value to the CLI parser, which reports it as usual.
    if (key && value === undefined && (argv[index + 1] === undefined || argv[index + 1].startsWith('--'))) key = undefined;
    if (!key) {
      args.push(arg);
      continue;
    }
    if (grouped) for (const alias of grouped[1]) args.push(`-${alias}`);
    if (value === undefined) value = argv[++index];
    options[key] = value;
  }
  return { args, options };
}

export function secureTelegramArgv({ argv = process.argv, execArgv = process.execArgv, env = process.env, execPath = process.execPath, execve = process.execve, warn = message => writeSync(2, `${message}\n`) } = {}) {
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
  const merged = { ...previous, ...options };
  if (!containsInlineSecret(options)) return merged;
  // Synchronous output survives execve; no exit handlers or async writes run.
  warn(INLINE_SECRET_WARNING);
  if (typeof execve !== 'function') {
    warn('Warning: this runtime cannot re-launch without these arguments, so they stay visible for the lifetime of the bot.');
    return merged;
  }
  try {
    execve(execPath, [execPath, ...execArgv, argv[1], ...args], { ...env, [TRANSPORT_KEY]: JSON.stringify(merged) });
  } catch {
    // Node errors can contain argv or env data. Never forward their text.
    warn('Warning: re-launching without these arguments failed, so they stay visible for the lifetime of the bot.');
    return merged;
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
export async function loadTelegramStartupConfig({ loadLenvConfig, inlineOptions = {}, argv = process.argv.slice(2), env = process.env, getenv = (key, fallback) => env[key] ?? fallback } = {}) {
  const path = configurationFileFromArgs(argv) ?? getenv('HIVE_MIND_CONFIGURATION_FILE', '');
  const environmentConfiguration = getenv('TELEGRAM_CONFIGURATION', '');
  if (environmentConfiguration) await loadLenvConfig({ configuration: environmentConfiguration, override: true, quiet: true });
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
