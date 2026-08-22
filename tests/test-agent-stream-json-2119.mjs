#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2119.
 *
 * `formal-ai with agent --verbose` emits pretty-printed, multi-line JSON
 * records. The stream readers split the raw output on newlines and called
 * JSON.parse per line, so every structured event was dropped: no session id,
 * no result summary, no error detection and - most visibly - a published
 * "Token usage: 0 input, 0 output" for a session that really used
 * 21677 input / 22834 output tokens.
 *
 * Evidence: docs/case-studies/issue-2119/data/logs/agent-scala-solution-draft.log
 * (lines 2245-2282 show the step_finish record; the PR comment reported 0/0).
 *
 * Framing records by balanced JSON instead of by newlines must also keep
 * handling strict NDJSON, records concatenated without a separator
 * (issue #1250) and records split across process chunks.
 */

import assert from 'node:assert/strict';

import { createJsonStreamScanner, createLineBuffer, parseJsonRecords } from '../src/json-stream.lib.mjs';
import { parseAgentTokenUsage } from '../src/agent-token-usage.lib.mjs';
import { parseCodexExecJsonOutput } from '../src/codex.lib.mjs';

const stepFinishRecord = {
  type: 'step_finish',
  timestamp: 1785420850750,
  sessionID: 'ses_04c9fe206ffeSfRyxn0SRerDHe',
  part: {
    id: 'prt_fb3602628001gT9qWhJRldfytM',
    type: 'step-finish',
    reason: 'tool-calls',
    cost: 0,
    tokens: { input: 21677, output: 22834, reasoning: 0, cache: { read: 0, write: 0 } },
    model: { providerID: 'formalai', requestedModelID: 'formal-ai', respondedModelID: 'formal-ai' },
    context: { contextLimit: 60000, outputLimit: 8192, usableContext: 51808, safeLimit: 38856 },
  },
};

const prettyStream = `${JSON.stringify(stepFinishRecord, null, 2)}\n`;
const ndjsonStream = `${JSON.stringify(stepFinishRecord)}\n`;
const concatenatedStream = `${JSON.stringify(stepFinishRecord)}${JSON.stringify(stepFinishRecord)}\n`;

// --- record framing -------------------------------------------------------

assert.equal(parseJsonRecords(prettyStream).length, 1, 'pretty-printed record must be recovered');
assert.deepEqual(parseJsonRecords(prettyStream)[0], stepFinishRecord);
assert.equal(parseJsonRecords(ndjsonStream).length, 1, 'NDJSON record must still be recovered');
assert.equal(parseJsonRecords(concatenatedStream).length, 2, 'concatenated records must be split (issue #1250)');

// A record split across process chunks must be assembled, not dropped.
const scanner = createJsonStreamScanner();
const serialized = JSON.stringify(stepFinishRecord, null, 2);
const splitAt = Math.floor(serialized.length / 2);
assert.deepEqual(scanner.write(serialized.slice(0, splitAt)), [], 'incomplete record must not be emitted');
const chunkEvents = scanner.write(`${serialized.slice(splitAt)}\n`);
assert.equal(chunkEvents.length, 1, 'record split across chunks must be emitted once complete');
assert.deepEqual(chunkEvents[0].value, stepFinishRecord);

// Braces inside strings must not confuse the framing.
const bracedRecords = parseJsonRecords('{"type":"text","text":"a } b { c"}\n');
assert.equal(bracedRecords.length, 1, 'braces inside strings must not break framing');
assert.equal(bracedRecords[0].text, 'a } b { c');

// Non-JSON output is still surfaced verbatim as text events.
const mixedScanner = createJsonStreamScanner();
const mixedEvents = [...mixedScanner.write(`agent: starting\n${JSON.stringify(stepFinishRecord)}\nagent: done\n`), ...mixedScanner.flush()];
assert.deepEqual(
  mixedEvents.map(event => event.type),
  ['text', 'json', 'text'],
  'plain tool output must still be surfaced'
);
assert.equal(mixedEvents[0].value, 'agent: starting');
assert.equal(mixedEvents[2].value, 'agent: done');

// An unbalanced fragment must be released rather than buffered forever.
const overflowScanner = createJsonStreamScanner({ maxPendingBytes: 64 });
const overflowEvents = overflowScanner.write(`{${'x'.repeat(200)}\n`);
assert.ok(overflowEvents.length > 0, 'unbalanced buffer must be released as text once it exceeds the cap');
assert.ok(
  overflowEvents.every(event => event.type === 'text'),
  'released fragment must be surfaced as text'
);

// --- token accounting -----------------------------------------------------

for (const [label, stream] of [
  ['pretty-printed', prettyStream],
  ['ndjson', ndjsonStream],
]) {
  const usage = parseAgentTokenUsage(stream);
  assert.equal(usage.stepCount, 1, `${label}: step must be counted`);
  assert.equal(usage.inputTokens, 21677, `${label}: input tokens must be counted`);
  assert.equal(usage.outputTokens, 22834, `${label}: output tokens must be counted`);
  assert.equal(usage.requestedModelId, 'formal-ai', `${label}: requested model must be captured`);
  assert.equal(usage.contextLimit, 60000, `${label}: context limit must be captured`);
}

const concatenatedUsage = parseAgentTokenUsage(concatenatedStream);
assert.equal(concatenatedUsage.stepCount, 2, 'concatenated records must both be counted');
assert.equal(concatenatedUsage.inputTokens, 21677 * 2, 'concatenated input tokens must accumulate');

// --- line-oriented streams (codex) ----------------------------------------

// The Codex parser is line-oriented, so it stays correct as long as it never
// sees half a line. A process chunk boundary can fall anywhere, which used to
// destroy both halves of the record it split.
const codexRecords = ['{"type":"thread.started","thread_id":"th_2119"}', '{"type":"turn.completed","usage":{"input_tokens":21677,"output_tokens":22834}}'];
const codexStream = `${codexRecords.join('\n')}\n`;

// Split the stream mid-record, exactly as a process chunk boundary would.
const codexSplitAt = codexStream.indexOf('usage') + 3;
const codexChunks = [codexStream.slice(0, codexSplitAt), codexStream.slice(codexSplitAt)];

const unbufferedState = codexChunks.reduce((state, chunk) => parseCodexExecJsonOutput(chunk, state, 'gpt-5.5'), {});
assert.equal(unbufferedState.tokenUsage.inputTokens, 0, 'baseline: an unbuffered split record is lost');

const codexLines = createLineBuffer();
let bufferedState = {};
for (const chunk of codexChunks) {
  bufferedState = parseCodexExecJsonOutput(codexLines.write(chunk), bufferedState, 'gpt-5.5');
}
bufferedState = parseCodexExecJsonOutput(codexLines.flush(), bufferedState, 'gpt-5.5');
assert.equal(bufferedState.sessionId, 'th_2119', 'buffered: session id survives a split chunk');
assert.equal(bufferedState.tokenUsage.inputTokens, 21677, 'buffered: input tokens survive a split chunk');
assert.equal(bufferedState.tokenUsage.outputTokens, 22834, 'buffered: output tokens survive a split chunk');

// A stream whose final record has no trailing newline must still be released.
const trailingBuffer = createLineBuffer();
assert.equal(trailingBuffer.write('{"type":"thread.started","thread_id":"th_tail"}'), '', 'partial line is held back');
const tailState = parseCodexExecJsonOutput(trailingBuffer.flush(), {}, 'gpt-5.5');
assert.equal(tailState.sessionId, 'th_tail', 'flush releases a record with no trailing newline');

console.log('✅ issue #2119: agent stream records are framed by balanced JSON');
