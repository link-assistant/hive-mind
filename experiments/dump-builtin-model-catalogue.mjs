#!/usr/bin/env node
/**
 * Dumps the built-in (statically bundled) model catalogue of Hive Mind.
 *
 * Used to produce docs/case-studies/issue-2202/data/hive-mind/builtin-model-catalogue.json
 * so the case study can compare what ships with the installation against what
 * is available live (router / codex catalogue / models.dev).
 *
 * Usage: node experiments/dump-builtin-model-catalogue.mjs > out.json
 */
import { execSync } from 'child_process';
import { getModelMapForTool, getDefaultModelForTool, primaryModelNames, MODELS_SUPPORTING_1M_CONTEXT, defaultFallbackModels } from '../src/models/index.mjs';

const TOOLS = ['claude', 'codex', 'agent', 'opencode', 'qwen', 'gemini'];
const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

const out = { _meta: { generatedFrom: 'src/models/index.mjs', commit, generatedAt: new Date().toISOString().slice(0, 10) }, tools: {} };
for (const tool of TOOLS) {
  const map = getModelMapForTool(tool) || {};
  out.tools[tool] = {
    default: getDefaultModelForTool(tool),
    primaryNames: primaryModelNames[tool] || [],
    aliasCount: Object.keys(map).length,
    resolvedIdCount: new Set(Object.values(map)).size,
    aliases: map,
  };
}
out.modelsSupporting1mContext = [...(MODELS_SUPPORTING_1M_CONTEXT || [])];
out.defaultFallbackModels = defaultFallbackModels;
console.log(JSON.stringify(out, null, 2));
