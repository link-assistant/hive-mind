/**
 * @hive-mind-test-suite default
 *
 * Issue #2293, item 5: the link-foundation/meta-language#196 log was 135,525
 * lines, 45,016 of them Codex TRACE/DEBUG/INFO output mirrored from stderr
 * under `--verbose`, plus 1,187 copies of one plugin manifest warning. Those
 * tracing lines now go to a file next to the log, repeated warnings are kept
 * once with a count, and anything that is not a tracing line is always kept.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { classifyCodexStderrLine, codexTracePathFor, createCodexStderrLog } from '../src/codex-stderr-log.lib.mjs';

const HEARTBEAT = minute => `2026-09-24T18:${String(minute).padStart(2, '0')}:00.583009Z DEBUG opentelemetry_sdk:  name="PeriodReaderThreadLoopAlive" Next export will happen after interval`;
const MANIFEST = minute => `2026-09-24T18:${String(minute).padStart(2, '0')}:01.1Z  WARN codex_core_plugins::manifest: ignoring interface.defaultPrompt[0]: prompt must be at most 128 characters path=/tmp/x/.codex-plugin/plugin.json`;

test('tracing levels are recognised with or without colour; other lines are not tracing', () => {
  assert.equal(classifyCodexStderrLine(HEARTBEAT(1)), 'DEBUG');
  assert.equal(classifyCodexStderrLine(MANIFEST(1)), 'WARN');
  assert.equal(classifyCodexStderrLine('\u001b[2m2026-09-24T18:00:00.1Z\u001b[0m \u001b[32m INFO\u001b[0m codex_otel.log_only: event.name="codex.tool_result"'), 'INFO');
  assert.equal(classifyCodexStderrLine('Error: stream disconnected before completion'), null);
  assert.equal(classifyCodexStderrLine('Reading prompt from stdin...'), null);
  assert.equal(codexTracePathFor('/tmp/solve-2026.log'), '/tmp/solve-2026.codex-trace.log');
  assert.equal(codexTracePathFor(null), null);
});

test('the meta-language 196 replay: debug goes to the trace file, a warning is kept once, errors are kept', () => {
  const files = {};
  const stderr = createCodexStderrLog({ tracePath: '/logs/solve.codex-trace.log', append: (path, text) => (files[path] = (files[path] ?? '') + text) });
  const logged = [];
  const chunks = [];
  for (let minute = 0; minute < 60; minute++) chunks.push(`${HEARTBEAT(minute)}\n${MANIFEST(minute)}\n`);
  chunks.push('2026-09-24T19:00:00.1Z ERROR codex_core::tools::router: error=plugin_id must match\nError: the final message Codex prints before exiting\n');
  // Chunk boundaries fall anywhere, also inside a line.
  const text = chunks.join('');
  for (let index = 0; index < text.length; index += 97) logged.push(...stderr.write(text.slice(index, index + 97)));
  logged.push(...stderr.end());
  assert.deepEqual(logged, [MANIFEST(0), '2026-09-24T19:00:00.1Z ERROR codex_core::tools::router: error=plugin_id must match', 'Error: the final message Codex prints before exiting', 'ℹ️  Codex stderr: 60 TRACE/DEBUG/INFO lines written to /logs/solve.codex-trace.log', `ℹ️  Codex stderr: repeated 59 more times: WARN codex_core_plugins::manifest: ignoring interface.defaultPrompt[0]: prompt must be at most 128 characters path=/tmp/x/.codex-plugin/plugin.json`]);
  assert.equal(files['/logs/solve.codex-trace.log'].split('\n').filter(Boolean).length, 60);
});

test('an unwritable trace file is reported, never thrown, and the run still logs its warnings', () => {
  const stderr = createCodexStderrLog({
    tracePath: '/ro/solve.codex-trace.log',
    append: () => {
      throw new Error('EROFS');
    },
  });
  const logged = [...stderr.write(`${HEARTBEAT(1)}\n${MANIFEST(1)}\n`), ...stderr.write(`${HEARTBEAT(2)}\n`), ...stderr.end()];
  assert.deepEqual(logged, [MANIFEST(1), 'ℹ️  Codex stderr: 2 TRACE/DEBUG/INFO lines left out of this log (/ro/solve.codex-trace.log: EROFS)']);
});

test('wiring: verbose Codex stderr is logged through the filter, the diagnostics parser still sees every line', () => {
  const codex = readFileSync(new URL('../src/codex.lib.mjs', import.meta.url), 'utf8');
  assert.match(codex, /createCodexStderrLog\(\{ tracePath: codexTracePathFor\(getLogFile\(\)\) \}\)/);
  assert.match(codex, /if \(argv\.verbose\) for \(const line of codexStderrLog\.write\(rawError\)\) await log\(line, \{ stream: 'stderr' \}\);/);
  assert.match(codex, /if \(argv\.verbose\) for \(const line of codexStderrLog\.end\(\)\) await log\(line, \{ stream: 'stderr' \}\);/);
  assert.doesNotMatch(codex, /await log\(rawError, \{ stream: 'stderr' \}\)/);
  assert.match(codex, /const errorOutput = codexStderrLines\.write\(rawError\);/, 'the full stderr still reaches the diagnostics parser');
});
