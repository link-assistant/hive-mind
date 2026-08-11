/**
 * Shared `--model` extraction for command argument vectors.
 *
 * Issue #2146 requires the Formal AI container lifecycle to be driven by the
 * *model* a task will actually run with, not by the CLI tool it happens to use
 * (`--tool claude --model formal-ai` is a Formal AI task; `--tool claude
 * --model opus` is not). Three call sites already needed this parse, so it
 * lives in one place instead of being copied a fourth time.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 */

/**
 * Read the model requested by an argument vector.
 *
 * Accepts every spelling Hive Mind's commands accept: `--model <value>`,
 * `-m <value>`, and `--model=<value>`.
 *
 * @param {string[]} args - Raw argument vector.
 * @returns {string|null} The requested model, or null when none was given.
 */
export const getModelFromArgs = args => {
  const list = Array.isArray(args) ? args : [];
  for (let index = 0; index < list.length; index += 1) {
    const arg = String(list[index] ?? '');
    if ((arg === '--model' || arg === '-m') && index + 1 < list.length) return list[index + 1];
    if (arg.startsWith('--model=')) return arg.substring('--model='.length);
  }
  return null;
};

export default { getModelFromArgs };
