/**
 * Shared command-argument helpers for the Telegram bot.
 *
 * Kept outside the entry point so the validation and locale propagation can be
 * exercised without booting Telegraf (issue #2198).
 */
import { validateClaudeSubAgentModelName, validateModelName } from './models/index.mjs';

/**
 * Validate model-related flags in an argument array.
 *
 * @param {string[]} args
 * @param {string} [tool]
 * @returns {string|null} Validation error, or null when the flags are valid
 */
export function validateModelInArgs(args, tool = 'claude') {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' || args[i] === '-m') {
      if (i + 1 < args.length) {
        const validation = validateModelName(args[i + 1], tool);
        if (!validation.valid) return validation.message;
      }
    } else if (args[i].startsWith('--model=')) {
      const validation = validateModelName(args[i].substring('--model='.length), tool);
      if (!validation.valid) return validation.message;
    } else if (args[i] === '--sub-agent-model' || args[i].startsWith('--sub-agent-model=')) {
      const modelName = args[i] === '--sub-agent-model' ? args[i + 1] : args[i].substring('--sub-agent-model='.length);
      if (!modelName) continue;
      if (tool !== 'claude') return `--sub-agent-model is only supported with --tool claude (current tool: ${tool})`;
      const validation = validateClaudeSubAgentModelName(modelName);
      if (!validation.valid) return `Invalid --sub-agent-model: ${validation.message}`;
    }
  }
  return null;
}

/** Append the user's locale unless any supported language flag is explicit. */
export function injectLanguageIfMissing(args, locale) {
  if (!locale || !Array.isArray(args)) return args;
  const langFlags = new Set(['--language', '--ui-language', '--work-language']);
  for (const arg of args) {
    const flag = arg.startsWith('--') ? arg.split('=')[0] : null;
    if (flag && langFlags.has(flag)) return args;
  }
  return [...args, '--language', locale];
}
