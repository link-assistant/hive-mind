#!/usr/bin/env node
// Issue #2591: print the "Available models" listing and alias resolution per tool.
import { getAvailableModelNames, validateModelName, validateRuntimeModelName } from '../src/models/index.mjs';

for (const tool of process.argv.slice(2).length ? process.argv.slice(2) : ['codex', 'claude', 'agent', 'opencode', 'gemini', 'qwen']) {
  console.log(`\n## ${tool} (${getAvailableModelNames(tool).length})\n${getAvailableModelNames(tool).join(', ')}`);
}
for (const [model, tool] of [
  ['astra', 'codex'],
  ['sol', 'codex'],
  ['luna', 'codex'],
  ['terra', 'codex'],
  ['mythos', 'claude'],
  ['opus-5.5', 'claude'],
  ['opus-6', 'claude'],
  ['astar', 'codex'],
]) {
  console.log(`\n${tool} ${model}:`, JSON.stringify(validateModelName(model, tool)).slice(0, 300));
  console.log(`runtime ${tool} ${model}:`, JSON.stringify(await validateRuntimeModelName(model, tool)).slice(0, 300));
}
