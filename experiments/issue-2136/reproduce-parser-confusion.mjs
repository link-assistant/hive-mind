#!/usr/bin/env node
// Issue #2136 — offline reproduction of the parser confusion.
//
// Feeds the verbatim stdout/stderr split from the incident log through the codex
// parser twice: once with stderr treated as protocol (the pre-fix behaviour,
// simulated by passing `source: 'stdout'` for the stderr chunk) and once with the
// stream separation the fix introduces.
//
// Run: node experiments/issue-2136/reproduce-parser-confusion.mjs

import { parseCodexExecJsonOutput, getCodexCompletionHealth } from '../../src/codex.lib.mjs';

// docs/case-studies/issue-2136/raw/solve-run-ad0c801a-….log.gz lines 1023, 1060, 26634
const CODEX_STDOUT = ['{"type":"thread.started","thread_id":"019fc725-cf6e-7242-a952-dd819e406a63"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"item_9","type":"agent_message","text":"PR: https://github.com/link-assistant/formal-ai/pull/913"}}', '{"type":"turn.completed","usage":{"input_tokens":41451312,"cached_input_tokens":40803072,"output_tokens":52128}}'].join('\n');

// ... lines 9322-9331: the OTEL trace of a tool result, dumping the nested
// agent's raw stdout (and truncated before that agent's own turn.completed).
const CODEX_STDERR = ['2026-08-03T10:54:47.430787Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=write_stdin call_id=exec-7cd150d3 duration_ms=10002 success=true output=Chunk ID: 4fc4fd', 'Wall time: 10.0021 seconds', 'Process running with session ID 68719', 'Output:', 'Warning: truncated output (original token count: 16102)', 'Total output lines: 168', '', '{"thread_id":"019fc742-c36e-7f20-87f0-6876ebf9b272","type":"thread.started"}', '{"type":"turn.started"}'].join('\n');

const run = stderrSource => {
  let state = parseCodexExecJsonOutput(CODEX_STDOUT, {}, 'gpt-5.6-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput(CODEX_STDERR, state, 'gpt-5.6-sol', { source: stderrSource });
  const health = getCodexCompletionHealth(state);
  return { state, health };
};

const report = (label, { state, health }) => {
  const counts = state.eventCounts;
  console.log(`${label}: turn.started=${counts['turn.started'] || 0} turn.completed=${counts['turn.completed'] || 0} → healthy=${health.healthy}${health.healthy ? '' : '  ← the false failure'}`);
  for (const reason of health.reasons) console.log(`   reason: ${reason}`);
};

report('stderr parsed as protocol (old)', run('stdout'));
report('stderr treated as telemetry (new)', run('stderr'));

// The two layers of the fix are independent. In the real run the echo arrived at
// line 9331, i.e. BEFORE codex's own turn.completed at line 26634, so the ordered
// lifecycle (Layer B) alone already rescues the run even if the stream separation
// (Layer A) is bypassed — while the count comparison it replaced does not.
const chronological = () => {
  const [head, ...tail] = CODEX_STDOUT.split('\n');
  let state = parseCodexExecJsonOutput([head, tail[0]].join('\n'), {}, 'gpt-5.6-sol', { source: 'stdout' });
  state = parseCodexExecJsonOutput(CODEX_STDERR, state, 'gpt-5.6-sol', { source: 'stdout' }); // pre-fix: stderr as protocol
  state = parseCodexExecJsonOutput(tail.slice(1).join('\n'), state, 'gpt-5.6-sol', { source: 'stdout' });
  return { state, health: getCodexCompletionHealth(state) };
};
report('echo before turn.completed, stderr still parsed as protocol (Layer B only)', chronological());
