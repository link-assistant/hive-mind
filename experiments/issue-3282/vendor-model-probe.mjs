/* global console */
// Probe: which model ids each tool's vendor serves, and which a Formal AI attribution rejects (#3279).
import { isVendorModel } from '../../src/formal-ai-pricing.lib.mjs';
import { detectHostedModel } from '../../src/formal-ai-attribution.lib.mjs';
for (const id of ['opus', 'sonnet-5-5', 'us.anthropic.claude-opus-4-8', 'bedrock/anthropic.claude-sonnet', 'fable', 'mythos-5', 'best', 'opusplan', 'formal-ai', 'Formal-AI', 'qwen3-coder', 'glm-5']) console.log('claude', id, isVendorModel({ tool: 'claude', modelId: id }), detectHostedModel(id));
for (const id of ['gpt-5.5', 'o3', 'o4-mini', 'openai.sol', 'sol', 'formalai/formal-ai', 'kimi-k2', 'gpt-oss-120b']) console.log('codex', id, isVendorModel({ tool: 'codex', modelId: id }), detectHostedModel(id));
for (const id of ['formalai/formal-ai', 'formal-ai', 'link-assistant/formal-ai', 'sonnetic', 'Oops', 'proto3']) console.log('detect', id, detectHostedModel(id));
