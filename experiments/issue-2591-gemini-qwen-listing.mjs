// Prints the Gemini and Qwen listings and alias mappings (issue #2591).
import { getAvailableModelNames, mapModelForTool, validateModelName } from '../src/models/index.mjs';
for (const tool of ['gemini', 'qwen']) {
  console.log(`${tool}: ${getAvailableModelNames(tool).join(', ')}`);
}
for (const [tool, m] of [
  ['gemini', 'flash'],
  ['gemini', 'gemini'],
  ['gemini', 'gemini-2.5-flash'],
  ['qwen', 'max'],
  ['qwen', 'plus'],
  ['qwen', 'qwen-flash'],
  ['qwen', 'qwen3-coder'],
  ['qwen', 'coder-model'],
]) {
  console.log(tool, m, '->', mapModelForTool(tool, m), validateModelName(m, tool).valid);
}
