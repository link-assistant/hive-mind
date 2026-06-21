/**
 * Shared parsing helpers for Telegram solve commands.
 *
 * Keeps /solve aliases and argument normalization testable without loading the
 * full Telegram bot entry point.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/525
 * @see https://github.com/link-assistant/hive-mind/issues/1618
 */

import { enhanceUnknownArgumentError } from './option-suggestions.lib.mjs';

export const TOOL_SOLVE_COMMAND_ALIASES = Object.freeze({
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  agent: 'agent',
  qwen: 'qwen',
  gemini: 'gemini',
});

export const SOLVE_COMMAND_NAMES = Object.freeze(['solve', 'do', 'continue', ...Object.keys(TOOL_SOLVE_COMMAND_ALIASES)]);

export function parseCommandArgs(text) {
  const firstLine = text.split('\n')[0].trim();
  const argsText = firstLine.replace(/^\/\w+(?:@\S+)?\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

  // Replace em-dash with double-dash to fix Telegram auto-replacement.
  const normalizedArgsText = argsText.replace(/—/g, '--');

  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < normalizedArgsText.length; i++) {
    const char = normalizedArgsText[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = null;
    } else if (char === ' ' && !inQuotes) {
      if (currentArg) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }

  if (currentArg) {
    args.push(currentArg);
  }

  return args;
}

function toCamelCaseOptionName(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function getYargsPositionalArg(argv, positionalNames = []) {
  if (!argv || typeof argv !== 'object') return null;

  for (const name of positionalNames) {
    const aliases = [name, toCamelCaseOptionName(name)];
    for (const alias of aliases) {
      if (typeof argv[alias] === 'string' && argv[alias].trim()) return argv[alias];
    }
  }

  if (Array.isArray(argv._)) {
    return argv._.find(value => typeof value === 'string' && value.trim()) || null;
  }

  return null;
}

export async function parseArgsWithYargs(args, yargsFactory, createYargsConfig) {
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = (_chunk, encoding, callback) => {
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };
  let parser = null;
  try {
    parser = createYargsConfig(yargsFactory());
    parser
      .exitProcess(false)
      .showHelpOnFail(false)
      .fail((msg, err) => {
        throw err || new Error(msg || 'Invalid arguments');
      });
    return await parser.parse(args);
  } catch (error) {
    throw enhanceUnknownArgumentError(error, parser);
  } finally {
    process.stderr.write = originalStderrWrite;
  }
}

export async function getFirstParsedPositionalArg(args, yargsFactory, createYargsConfig, positionalNames = []) {
  try {
    return getYargsPositionalArg(await parseArgsWithYargs(args, yargsFactory, createYargsConfig), positionalNames);
  } catch {
    return null;
  }
}

export function moveArgumentToFront(args, target, normalize = value => value) {
  if (!target) return [...args];
  const normalizedTarget = normalize(target);
  const index = args.findIndex(arg => normalize(arg) === normalizedTarget);
  if (index < 0) return [normalizedTarget, ...args];
  return [normalizedTarget, ...args.slice(0, index), ...args.slice(index + 1)];
}

export function getSolveCommandNameFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const firstLine = text.split('\n')[0].trim();
  const match = firstLine.match(/^\/(\w+)(?:@\S+)?(?:\s|$)/);
  return match ? match[1].toLowerCase() : null;
}

export function getSolveToolAliasFromText(text) {
  const command = getSolveCommandNameFromText(text);
  return command ? TOOL_SOLVE_COMMAND_ALIASES[command] || null : null;
}

export function applySolveToolAlias(args, toolAlias) {
  if (!toolAlias || args.length === 0) {
    return args;
  }

  const filteredArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--tool') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        i++;
      }
      continue;
    }

    if (arg.startsWith('--tool=')) {
      continue;
    }

    filteredArgs.push(arg);
  }

  return [...filteredArgs, '--tool', toolAlias];
}
