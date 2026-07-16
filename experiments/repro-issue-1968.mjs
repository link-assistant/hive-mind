#!/usr/bin/env node
// Reproduction for issue #1968:
//   "CODEX execution failed with Cannot read properties of null (reading 'type')"
//
// The Codex CLI echoes the stdout of every command it runs back into its own
// NDJSON stream (codex_otel telemetry `Output:` blocks — same mechanism as issue
// #1955). In the captured failure the agent ran:
//   sed -n '760,1340p' plugins/composio-direct/index.js
// and that source contains a getApiKey() fallback whose `?? null` puts a bare
// `null` token on its own line:
//
//     return (
//       process.env.COMPOSIO_DIRECT_COMPOSIO_API_KEY ??
//       process.env.COMPOSIO_API_KEY ??
//       null
//     );
//
// Our line-by-line parser trimmed that echoed line to `null`, JSON.parse('null')
// returned `null`, and the unguarded `data.type` access threw
// "Cannot read properties of null (reading 'type')", aborting the whole solve.

import { parseCodexExecJsonOutput } from '../src/codex.lib.mjs';

// A realistic chunk: a real Codex event, then the echoed source line `null`,
// then another real event.
const chunk = [
  '{"type":"item.started","item":{"id":"item_25","type":"command_execution","command":"sed -n \'760,1340p\' index.js"}}',
  '      process.env.COMPOSIO_API_KEY ??',
  '      null', // <-- the echoed `?? null` fallback, trimmed to a bare null token
  '    );',
  '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
].join('\n');

try {
  const state = parseCodexExecJsonOutput(chunk, {}, 'gpt-5.5');
  console.log('OK — no crash. eventCounts =', JSON.stringify(state.eventCounts));
  console.log('   turn.completed accounted:', state.tokenUsage.stepCount === 1);
} catch (error) {
  console.log('CRASH:', error.message);
  process.exit(1);
}
