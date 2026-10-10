#!/usr/bin/env node
/**
 * Issue #2840: failure comments must name the model that actually ran, and the
 * default fallback must be chosen from it.
 *
 * On link-assistant/web-capture#178 Claude was OOM-killed (exit 137) before its
 * `result` event. All 669 `model` fields of its stream said `claude-opus-5-5`,
 * yet the failure comment said `**Model: Claude Opus 5** (claude-opus-5)`,
 * because the bundled `opus` mapping was stale and the comment presented that
 * mapping as the model that ran. The default fallback came from the same
 * mapping (`opus → claude-opus-5 → opus-4-8`), skipping Opus 5.
 *
 * Run with: node tests/issue-2840-observed-model.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractClaudeEventModelIds, getLatestObservedModelFor, getObservedModelIds, recordObservedModel, resetObservedModels } from '../src/observed-models.lib.mjs';
import { getModelInfoForComment, resolveDefaultFallbackModel, resolveModelId } from '../src/models/index.mjs';
import { resolveConfiguredFallbackModel } from '../src/tool-retry.lib.mjs';
import { attachLogToGitHub } from '../src/github.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    resetObservedModels();
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

// Stream events as Claude Code emitted them on web-capture#178 (trimmed).
const STREAM = [
  { type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-5-5', tools: [] },
  { type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-opus-5-5', usage: { input_tokens: 3, output_tokens: 1 } } },
  { type: 'assistant', parent_tool_use_id: 'toolu_01', message: { model: 'claude-haiku-5-5', usage: { input_tokens: 9, output_tokens: 2 } } },
  { type: 'assistant', parent_tool_use_id: null, message: { model: '<synthetic>', usage: {} } },
  { type: 'user', message: { content: [] } },
  { type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 7 } } },
];

/** Feed the stream as claude.lib.mjs does, for one requested model. */
const replay = (events, requestedModel) => {
  for (const data of events) for (const observed of extractClaudeEventModelIds(data)) recordObservedModel({ ...observed, requestedModel });
};

console.log('\n📋 Alias table (Issue #2840, #2591)\n');

await test('opus resolves to the model Claude Code runs today', () => {
  assert.equal(resolveModelId('opus', 'claude'), 'claude-opus-5-5');
});

await test('the default fallback for opus no longer skips Opus 5', () => {
  assert.equal(resolveDefaultFallbackModel('claude', 'opus'), 'opus-5');
  assert.equal(resolveDefaultFallbackModel('claude', 'claude-opus-5-5'), 'opus-5');
  assert.equal(resolveDefaultFallbackModel('claude', 'claude-opus-5'), 'opus-4-8');
});

console.log('\n📋 Model IDs from the stream\n');

await test('system/init and assistant events report their model', () => {
  assert.deepEqual(extractClaudeEventModelIds(STREAM[0]), [{ modelId: 'claude-opus-5-5', source: 'system/init', fromSubagent: false }]);
  assert.deepEqual(extractClaudeEventModelIds(STREAM[1]), [{ modelId: 'claude-opus-5-5', source: 'assistant', fromSubagent: false }]);
  assert.deepEqual(extractClaudeEventModelIds(STREAM[2]), [{ modelId: 'claude-haiku-5-5', source: 'assistant', fromSubagent: true }]);
});

await test('synthetic, user and malformed events report nothing', () => {
  assert.deepEqual(extractClaudeEventModelIds(STREAM[3]), []);
  assert.deepEqual(extractClaudeEventModelIds(STREAM[4]), []);
  assert.deepEqual(extractClaudeEventModelIds(null), []);
  assert.deepEqual(extractClaudeEventModelIds({ type: 'system', subtype: 'init' }), []);
});

await test('main-thread models come first, sub-agent models after, each once', () => {
  replay(STREAM, 'opus');
  assert.deepEqual(getObservedModelIds(), ['claude-opus-5-5', 'claude-haiku-5-5']);
  assert.equal(getLatestObservedModelFor('opus'), 'claude-opus-5-5');
  assert.equal(getLatestObservedModelFor('sonnet'), null, 'no observation for another requested model');
});

await test('recordObservedModel reports only the first sighting of an ID', () => {
  assert.equal(recordObservedModel({ modelId: 'claude-opus-5-5', requestedModel: 'opus' }), true);
  assert.equal(recordObservedModel({ modelId: 'claude-opus-5-5', requestedModel: 'opus' }), false);
  assert.equal(recordObservedModel({ modelId: '<synthetic>', requestedModel: 'opus' }), false);
});

await test('after a fallback switch the latest model for the new request wins', () => {
  replay(STREAM, 'opus');
  replay([{ type: 'system', subtype: 'init', model: 'claude-opus-5' }], 'opus-5');
  assert.equal(getLatestObservedModelFor('opus'), 'claude-opus-5-5');
  assert.equal(getLatestObservedModelFor('opus-5'), 'claude-opus-5');
  resetObservedModels();
  assert.deepEqual(getObservedModelIds(), []);
});

console.log('\n📋 Fallback selection on retries\n');

await test('the fallback follows the model that ran, not the alias mapping', () => {
  assert.equal(resolveConfiguredFallbackModel({ tool: 'claude', currentModel: 'opus', actualModel: 'claude-opus-5-5' }), 'opus-5');
  // Had Claude's rolling alias still pointed at Opus 5, the chain continues from there.
  assert.equal(resolveConfiguredFallbackModel({ tool: 'claude', currentModel: 'opus', actualModel: 'claude-opus-5' }), 'opus-4-8');
  // An unknown actual model falls back to the requested model's chain.
  assert.equal(resolveConfiguredFallbackModel({ tool: 'claude', currentModel: 'opus', actualModel: 'claude-unreleased-9' }), 'opus-5');
  assert.equal(resolveConfiguredFallbackModel({ tool: 'claude', currentModel: 'opus' }), 'opus-5');
});

await test('an explicit --fallback-model still wins over the observed model', () => {
  assert.equal(resolveConfiguredFallbackModel({ tool: 'claude', currentModel: 'opus', configuredFallbackModel: 'sonnet', explicit: true, actualModel: 'claude-opus-5-5' }), 'sonnet');
});

console.log('\n📋 Failure comment\n');

await test('without an actual model the requested alias is not presented as the model', async () => {
  const result = await getModelInfoForComment({ requestedModel: 'opus', tool: 'claude', actualModelUnknownReason: 'session ended before result' });
  assert.ok(result.includes('Requested (actual model unknown — session ended before result): `opus`'), result);
  assert.ok(!result.includes('**Model:'), result);
});

await test('with the observed model the comment names it', async () => {
  const result = await getModelInfoForComment({ requestedModel: 'opus', tool: 'claude', actualModelIds: ['claude-opus-5-5'] });
  assert.ok(result.includes('**Model:'), result);
  assert.ok(result.includes('`claude-opus-5-5`'), result);
  assert.ok(!result.includes('actual model unknown'), result);
  assert.ok(!/`claude-opus-5`/.test(result), result);
});

await test('replay of web-capture#178: an OOM-killed session’s failure comment names claude-opus-5-5', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2840-'));
  const savedUsage = global.latestLogUsage;
  try {
    const logFile = path.join(dir, 'solve.log');
    await fs.writeFile(logFile, 'a transcript line\n'.repeat(50));
    replay(STREAM, 'opus'); // the stream arrived, then exit 137 before any `result`
    const bodies = [];
    const $ = first => async () => {
      if (first?.stdin) bodies.push(JSON.parse(first.stdin).body);
      return { code: 0, stdout: first?.stdin ? '{"id":6018810946}' : 'public', stderr: '' };
    };
    const attached = await attachLogToGitHub({
      logFile,
      targetType: 'pr',
      targetNumber: 178,
      owner: 'link-assistant',
      repo: 'web-capture',
      $,
      log: async () => {},
      recordResources: async () => {},
      errorMessage: 'Claude command failed with exit code 137',
      requestedModel: 'opus',
      tool: 'claude',
      resultModelUsage: null,
    });
    assert.equal(attached, true);
    assert.equal(bodies.length, 1);
    const [body] = bodies;
    assert.ok(body.includes('`claude-opus-5-5`'), body.slice(0, 2000));
    assert.ok(!/`claude-opus-5`/.test(body), body.slice(0, 2000));
  } finally {
    global.latestLogUsage = savedUsage;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

await test('a failure comment with no stream models says the actual model is unknown', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2840-'));
  const savedUsage = global.latestLogUsage;
  try {
    const logFile = path.join(dir, 'solve.log');
    await fs.writeFile(logFile, 'a transcript line\n'.repeat(50));
    const bodies = [];
    const $ = first => async () => {
      if (first?.stdin) bodies.push(JSON.parse(first.stdin).body);
      return { code: 0, stdout: first?.stdin ? '{"id":6018810947}' : 'public', stderr: '' };
    };
    await attachLogToGitHub({ logFile, targetType: 'pr', targetNumber: 178, owner: 'link-assistant', repo: 'web-capture', $, log: async () => {}, recordResources: async () => {}, errorMessage: 'Claude command failed with exit code 137', requestedModel: 'opus', tool: 'claude', resultModelUsage: null });
    assert.equal(bodies.length, 1);
    assert.ok(bodies[0].includes('Requested (actual model unknown — session ended before result): `opus`'), bodies[0].slice(0, 2000));
    assert.ok(!bodies[0].includes('**Model:'), bodies[0].slice(0, 2000));
  } finally {
    global.latestLogUsage = savedUsage;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
