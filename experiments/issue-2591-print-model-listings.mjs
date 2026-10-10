#!/usr/bin/env node
// Issue #2591: print what Hive Mind lists and resolves for every tool, so the
// before/after listings in the case study can be regenerated.
// Usage: node experiments/issue-2591-print-model-listings.mjs [--live]
import { getAvailableModelNames, validateModelName, validateRuntimeModelName } from '../src/models/index.mjs';

const live = process.argv.includes('--live');
const tools = ['claude', 'codex', 'gemini', 'qwen', 'agent', 'opencode'];
const probes = {
  claude: ['opus', 'sonnet', 'haiku', 'fable', 'mythos', 'best', 'opus-5.5', 'claude-opus-5.5', 'sonnet-5.5'],
  codex: ['astra', 'sol', 'terra', 'luna', 'daybreak-blue', 'daybreak-red', 'gpt-6-astra', 'gpt-6.1-sol'],
  gemini: ['flash', 'pro', 'flash-lite', 'auto'],
  qwen: ['qwen', 'coder-model'],
  agent: ['nemotron-3-super-free'],
  opencode: ['grok'],
};

for (const tool of tools) {
  const names = getAvailableModelNames(tool);
  console.log(`\n## ${tool} (${names.length} listed)`);
  console.log(names.join(', '));
  for (const probe of probes[tool]) {
    const result = live ? await validateRuntimeModelName(probe, tool) : validateModelName(probe, tool);
    console.log(`  ${probe} -> ${result.valid ? `${result.mappedModel}${result.source ? ` (${result.source})` : ''}` : `INVALID: ${result.message.split('\n')[0]}${result.suggestions?.length ? ` (did you mean ${result.suggestions.join(', ')})` : ''}`}`);
  }
}
