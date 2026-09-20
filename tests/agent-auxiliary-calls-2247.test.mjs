#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2247 (H5): the Agent CLI must not make
 * per-message summary and title calls during a Hive Mind run.
 *
 * Evidence from the Scala reproduction run (`--tool agent --model formal-ai`):
 * twelve records per session of
 *
 *     ERROR ... AI_APICallError: HTTP 400 {"type":"MissingSessionID",
 *     "message":"... OpenCode's free tier can only be used in OpenCode"}
 *
 * from `opencode/big-pickle` — a provider the run was never authenticated for
 * and never asked for. `--model formalai/formal-ai` was passed correctly; these
 * calls simply do not use `--model`. `SessionSummary.summarizeMessage`
 * (@link-assistant/agent, src/session/summary.ts) runs after every user
 * message, and both its summary call and the "generating title via API" call
 * right below it resolve `userMsg.compactionModel`, whose default cascade
 * starts at `opencode/big-pickle`.
 *
 * Issue #2236 had recorded `agent` as already compliant on the reading that
 * `--summarize-session` is summarization, which that policy deliberately keeps.
 * It is not: compaction is src/session/compaction.ts, selected by
 * `--compaction-model`/`--compaction-models`, and it never reads
 * `config.summarizeSession`. Turning the summary off therefore removes the
 * failing calls and leaves the context-window rescue intact.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 * @see https://github.com/link-assistant/hive-mind/issues/2236
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_AUXILIARY_DISABLE_ARGS, buildAgentArgs } from '../src/agent-command.lib.mjs';
import { AGENT_AUXILIARY_DISABLE_FLAGS, AGENT_SUMMARIZATION_KEEP_FLAGS, AUXILIARY_MODEL_CALLS_POLICY_TOOLS, TOOLS_ALREADY_COMPLIANT, describeAuxiliaryModelCallsPolicy, isAuxiliaryModelCallsDisabled } from '../src/auxiliary-model-calls-policy.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFileSync(join(__dirname, '..', 'src', name), 'utf8');

// --- Every `--tool agent` run passes both flags ---------------------------

assert.deepEqual([...AGENT_AUXILIARY_DISABLE_ARGS], ['--no-summarize-session', '--no-generate-title'], 'both negated flags are what agent 0.26.1 accepts; a renamed flag makes the CLI exit, not degrade');

{
  const args = buildAgentArgs({ model: 'formalai/formal-ai' });
  assert.deepEqual(args, ['--model', 'formalai/formal-ai', '--no-summarize-session', '--no-generate-title'], 'the plain invocation already carries the policy');

  // Distinct argv atoms, for the same reason as issue #2146: command-stream
  // keeps an interpolated string as a single atom.
  for (const flag of AGENT_AUXILIARY_DISABLE_ARGS) assert.ok(args.includes(flag), `${flag} must be its own argv atom`);
}

{
  const args = buildAgentArgs({ model: 'formalai/formal-ai', verbose: true, resume: 'abc', streamingInput: true });
  assert.deepEqual(args, ['--model', 'formalai/formal-ai', '--no-summarize-session', '--no-generate-title', '--verbose', '--resume', 'abc', '--no-fork', '--input-format', 'stream-json', '--output-format', 'stream-json'], 'the flags survive resume and streaming input, the two shapes the reproduction runs used');
}

// The #2236 opt-out stays the single way out, and taking it adds no arguments.
assert.deepEqual(buildAgentArgs({ model: 'formalai/formal-ai', auxiliaryModelCallsDisabled: false }), ['--model', 'formalai/formal-ai'], '--no-auxiliary-model-calls-disabled must reproduce the pre-fix argv exactly');

// --- The policy module tells the truth about `agent` ----------------------

assert.deepEqual([...TOOLS_ALREADY_COMPLIANT], [], '`agent` was the only entry and issue #2247 falsified it');
assert.ok(AUXILIARY_MODEL_CALLS_POLICY_TOOLS.includes('agent'));
assert.equal(describeAuxiliaryModelCallsPolicy('agent'), 'flags --no-summarize-session --no-generate-title', 'the description is what the docs quote; it must name the actual knobs');
assert.equal(AGENT_AUXILIARY_DISABLE_FLAGS, AGENT_AUXILIARY_DISABLE_ARGS, 'one list, two names — the policy hub and the place it is applied cannot drift');

// Compaction is load-bearing and stays on: it is a different subsystem with
// different flags, and none of them is disabled here.
assert.deepEqual([...AGENT_SUMMARIZATION_KEEP_FLAGS], ['--compaction-model', '--compaction-models']);
for (const keep of AGENT_SUMMARIZATION_KEEP_FLAGS) {
  assert.ok(!AGENT_AUXILIARY_DISABLE_FLAGS.some(flag => flag.includes(keep.replace('--', ''))), `${keep} must not be touched — disabling compaction would not make it cheaper, it would remove it`);
}

// --- The runner is wired to the flag, not to a hardcoded true -------------

{
  const agentLib = readSrc('agent.lib.mjs');
  assert.ok(agentLib.includes('auxiliaryModelCallsDisabled: isAuxiliaryModelCallsDisabled(argv)'), 'agent.lib must build the argv from argv, not unconditionally');
  assert.equal(isAuxiliaryModelCallsDisabled({}), true, 'an argv that predates the flag still gets the policy');
  assert.equal(isAuxiliaryModelCallsDisabled({ auxiliaryModelCallsDisabled: false }), false);
}

console.log('PASS: issue #2247 (H5) the Agent CLI stops calling opencode/big-pickle for summaries and titles');
