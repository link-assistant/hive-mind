#!/usr/bin/env node
// Issue #2591: how the non-Codex/Claude tools treat model IDs their installed CLIs offer today.
import { validateModelName, validateRuntimeModelName } from '../src/models/index.mjs';

const samples = {
  gemini: ['gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  qwen: ['coder-model', 'qwen3.7-max', 'qwen3.8-max'],
  opencode: ['opencode/big-pickle', 'opencode/nemotron-3-ultra-free', 'opencode/claude-opus-5-5'],
  agent: ['opencode/nemotron-3-ultra-free', 'nemotron-3.5-lightning-free'],
};
for (const [tool, models] of Object.entries(samples)) {
  for (const model of models) {
    const bundled = validateModelName(model, tool);
    const runtime = await validateRuntimeModelName(model, tool, { availableModels: [] });
    console.log(`${tool} ${model}: bundled=${bundled.valid ? bundled.mappedModel : 'invalid'} runtime=${runtime.valid ? `${runtime.mappedModel} (${runtime.source})` : 'invalid'}`);
  }
}
