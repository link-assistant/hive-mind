/** Keep bot credentials out of the running process's OS command line (#2647). */
import fs from 'node:fs/promises';

export function moveTelegramSecretsOffArgv({ argv = process.argv, env = process.env, execve = process.execve, execPath = process.execPath, execArgv = process.execArgv, warn = message => process.stderr.write(`${message}\n`) } = {}) {
  const clean = argv.slice(0, 2);
  const nextEnv = { ...env };
  let changed = false;
  for (let i = 2; i < argv.length; i++) {
    let match = /^(--configuration|--token|-c|-t)(?:=(.*))?$/s.exec(argv[i]);
    if (!match && /^-[ct]./s.test(argv[i])) match = [argv[i], argv[i].slice(0, 2), argv[i].slice(2).replace(/^=/, '')];
    if (!match) {
      clean.push(argv[i]);
      continue;
    }
    const value = match[2] ?? argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${match[1]} requires a value`);
    const name = match[1] === '--token' || match[1] === '-t' ? 'HIVE_MIND_TELEGRAM_CLI_TOKEN' : 'HIVE_MIND_TELEGRAM_CLI_CONFIGURATION';
    nextEnv[name] = value;
    changed = true;
  }
  if (!changed) return false;
  if (typeof execve !== 'function') throw new Error('Inline bot credentials require process.execve; use --configuration-file or environment variables.');
  warn('Loading inline bot configuration through the environment. Use --configuration-file to keep credentials off command lines.');
  // execve replaces the same process: PID, signals and exit status are retained,
  // and /proc/self/cmdline contains only the cleaned command in the bot.
  execve(execPath, [execPath, ...execArgv, ...clean.slice(1)], nextEnv);
  return true; // Reached only by an injected test executor.
}

/** Read an explicit operator-provided file; missing files fail visibly. */
export async function readPrivateTelegramConfiguration(filePath) {
  if (!filePath) return null;
  return fs.readFile(filePath, 'utf8');
}

/** Load private inputs before rebuilding parser defaults from the final env. */
export async function loadTelegramConfiguration({ parse, loadConfiguration, env = process.env }) {
  const cliToken = env.HIVE_MIND_TELEGRAM_CLI_TOKEN;
  const cliConfiguration = env.HIVE_MIND_TELEGRAM_CLI_CONFIGURATION;
  delete env.HIVE_MIND_TELEGRAM_CLI_TOKEN;
  delete env.HIVE_MIND_TELEGRAM_CLI_CONFIGURATION;
  if (cliConfiguration !== undefined) env.TELEGRAM_CONFIGURATION = cliConfiguration;
  const initial = parse();
  const fileConfiguration = await readPrivateTelegramConfiguration(initial.configurationFile);
  if (fileConfiguration !== null) await loadConfiguration(fileConfiguration);
  if (initial.configuration) await loadConfiguration(initial.configuration);
  // Explicit --token wins over inline configuration, file, .lenv and .env.
  if (cliToken !== undefined) env.TELEGRAM_BOT_TOKEN = cliToken;
  return parse();
}
