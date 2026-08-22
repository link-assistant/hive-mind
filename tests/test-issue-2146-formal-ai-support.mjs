#!/usr/bin/env node

/**
 * Regression coverage for issue #2146.
 *
 * The Aug 8 Agent run received `--model formalai/formal-ai --verbose` as one
 * process.argv element. Agent could not parse the requested model and contacted
 * its default OpenCode provider. Claude and Codex were correctly routed to
 * Formal AI, but an outdated binary repeatedly returned a plan without doing
 * repository work. That plan was then posted to GitHub as collapsed prose.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

import { buildAgentArgs, detectFormalAiAgentRoutingMismatch, isAgentStrongCompletionEvent } from '../src/agent-command.lib.mjs';
import { assertSupportedFormalAiVersion, FORMAL_AI_MINIMUM_VERSION, parseFormalAiVersion } from '../src/formal-ai-version.lib.mjs';
import { formatWorkingSessionSummaryMarkdown } from '../src/working-session-summary.lib.mjs';

// Agent flags must be distinct argv atoms. An interpolated command-stream
// string preserves the whole string as one atom, which caused the reported run.
assert.deepEqual(buildAgentArgs({ model: 'formalai/formal-ai', verbose: true, resume: 'session with spaces', streamingInput: true }), ['--model', 'formalai/formal-ai', '--verbose', '--resume', 'session with spaces', '--no-fork', '--input-format', 'stream-json', '--output-format', 'stream-json']);

// Even if an upstream parser regresses, a Formal AI run must stop before the
// Agent can silently select and contact another provider.
assert.match(detectFormalAiAgentRoutingMismatch({ type: 'log', message: 'using explicit provider/model', providerID: 'opencode', modelID: 'minimax-m2.5-free' }, 'formalai/formal-ai'), /requested formalai\/formal-ai.*selected opencode\/minimax-m2\.5-free/i);
assert.equal(detectFormalAiAgentRoutingMismatch({ type: 'log', message: 'using explicit provider/model', providerID: 'formalai', modelID: 'formal-ai' }, 'formalai/formal-ai'), null);
assert.match(detectFormalAiAgentRoutingMismatch({ type: 'log', message: 'CRITICAL: --model flag detected but could not be parsed; default model will be used instead' }, 'formalai/formal-ai'), /could not parse.*default model/i);

// `session.idle` also follows terminal API failures. Only an explicit terminal
// success record is strong enough to clear a preceding streamed error.
assert.equal(isAgentStrongCompletionEvent({ type: 'session.idle' }), false);
assert.equal(isAgentStrongCompletionEvent({ type: 'step_finish', part: { reason: 'stop' } }), true);
assert.equal(isAgentStrongCompletionEvent({ type: 'result', status: 'success' }), true);

assert.equal(parseFormalAiVersion('formal-ai 0.336.0\n'), '0.336.0');
// The floor is the first release with the persisted-memory upgrade contract
// (formal-ai#982): Hive Mind now replaces the container while it is idle, so an
// unattended non-destructive memory migration is mandatory, not optional.
assert.equal(FORMAL_AI_MINIMUM_VERSION, '0.336.0');
assert.doesNotThrow(() => assertSupportedFormalAiVersion('0.336.0'));
assert.throws(() => assertSupportedFormalAiVersion('0.333.2'), /requires Formal AI >= 0\.336\.0.*found 0\.333\.2/i);
assert.throws(() => assertSupportedFormalAiVersion(null), /could not determine the Formal AI version/i);

const formalAiPlan = ['Recorded and verified the bounded repository work-item plan.', '', 'Plan event (`.formal-ai/general-change-plan.lino`):', '', 'general_change_plan', '  id general-change-plan', '  goal First line\twith a tab', '  execution_mode full_execution'].join('\n');
const formattedPlan = formatWorkingSessionSummaryMarkdown(formalAiPlan);
assert.match(formattedPlan, /Plan event .*:\n\n```text\ngeneral_change_plan\n {2}id general-change-plan/);
assert.ok(formattedPlan.endsWith('  execution_mode full_execution\n```'));
assert.equal(formatWorkingSessionSummaryMarkdown(formattedPlan), formattedPlan, 'formatting is idempotent');
assert.equal(formatWorkingSessionSummaryMarkdown('Normal **Markdown** stays normal.'), 'Normal **Markdown** stays normal.');
assert.equal(formatWorkingSessionSummaryMarkdown('Already fenced:\n\n```text\na  b\n```'), 'Already fenced:\n\n```text\na  b\n```');

console.log('PASS: issue #2146 Formal AI routing, version, completion, and Markdown policies');
