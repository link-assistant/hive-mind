#!/usr/bin/env node
// Issue #2840: what the PR comment and default fallback say for the default `opus` model
// when the session produced no actual model IDs (crash, kill or error before `result`).
// Before the fix: `opus` (`claude-opus-5`), "**Model: Claude Opus 5**" and fallback opus-4-8.
const m = await import('../src/models/index.mjs');
console.log('resolveModelId(opus) =', m.resolveModelId('opus', 'claude'));
console.log('fallback(opus) =', m.resolveDefaultFallbackModel('claude', 'opus'));
console.log(await m.getModelInfoForComment({ requestedModel: 'opus', tool: 'claude' }));
