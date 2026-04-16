/**
 * Shared parsing helpers for Telegram solve commands.
 *
 * Keeps /solve aliases and argument normalization testable without loading the
 * full Telegram bot entry point.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/525
 * @see https://github.com/link-assistant/hive-mind/issues/1618
 */

export const TOOL_SOLVE_COMMAND_ALIASES = Object.freeze({
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  agent: 'agent',
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
