/**
 * @hive-mind-test-suite default
 *
 * Issue #4079: a Codex `codex.tool_result` record spans many stderr lines. Its
 * INFO header went to the trace file, but its continuation lines (the tool
 * call's arguments, 63k `.` lines in the incident, and the trailer with
 * `user.account_id=` and `user.email=`) were kept as "not a tracing line" and
 * published with `--attach-logs`. Continuation lines now follow their record,
 * runs of one line collapse into a count, and account identifiers are redacted
 * in the log and in everything sanitizeLogContent publishes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCodexStderrLog } from '../src/codex-stderr-log.lib.mjs';
import { redactTelemetryIdentity, redactTelemetryIdentityWithCount } from '../src/telemetry-identity-redaction.lib.mjs';

const EMAIL = 'operator@example.invalid';
const ACCOUNT = '00000000-1111-2222-3333-444444444444';
const TRAILER = ` mcp_server= event.timestamp=2026-11-18T01:27:18.858Z conversation.id=thread-1 auth_mode="Chatgpt" originator=codex_exec user.account_id="${ACCOUNT}" user.email="${EMAIL}" terminal.type=unknown model=gpt-test`;
const TOOL_RESULT = (dots, minute = 27) => [`2026-11-18T01:${minute}:18.858Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=exec arguments=Need work exact continue.`, ...Array(dots).fill('.'), ` output=Script failed`, `SyntaxError: Unexpected identifier 'exactlog'${TRAILER}`];

test('account identifiers are redacted, quoted or bare, coloured or not; the key stays', () => {
  assert.equal(redactTelemetryIdentity(TRAILER), TRAILER.replace(`"${ACCOUNT}"`, '"<redacted>"').replace(`"${EMAIL}"`, '"<redacted>"'));
  assert.equal(redactTelemetryIdentity(`git -c user.name=hive -c user.email=${EMAIL} commit`), 'git -c user.name=hive -c user.email=<redacted> commit');
  assert.equal(redactTelemetryIdentity(`\u001b[3muser.email\u001b[0m\u001b[2m=\u001b[0m"${EMAIL}"`), '\u001b[3muser.email\u001b[0m\u001b[2m=\u001b[0m"<redacted>"');
  assert.equal(redactTelemetryIdentity(`{chatgpt_account_id='${ACCOUNT}'}`), "{chatgpt_account_id='<redacted>'}");
  // Session ids are needed to resume and are not account identifiers.
  assert.equal(redactTelemetryIdentity('conversation.id=thread-1 session.id=abc thread.id=t'), 'conversation.id=thread-1 session.id=abc thread.id=t');
  // Not a suffix of a longer key, and idempotent.
  assert.equal(redactTelemetryIdentity('git_user.email=x'), 'git_user.email=x');
  const once = redactTelemetryIdentityWithCount(TRAILER);
  assert.equal(once.redacted, 2);
  assert.deepEqual(redactTelemetryIdentityWithCount(once.text), { text: once.text, redacted: 0 });
});

test('the incident replay: a multi-line INFO record stays out of the log, its repeats collapse in the trace file', () => {
  const files = {};
  const stderr = createCodexStderrLog({ tracePath: '/logs/solve.codex-trace.log', append: (path, text) => (files[path] = (files[path] ?? '') + text) });
  const text = [...TOOL_RESULT(63437), '2026-11-18T01:29:53.4Z ERROR codex_core::session: turn failed', 'Error: Incomplete response returned, reason: max_output_tokens', ''].join('\n');
  const logged = [];
  for (let index = 0; index < text.length; index += 4093) logged.push(...stderr.write(text.slice(index, index + 4093)));
  logged.push(...stderr.end());
  assert.deepEqual(logged, ['2026-11-18T01:29:53.4Z ERROR codex_core::session: turn failed', 'Error: Incomplete response returned, reason: max_output_tokens', 'ℹ️  Codex stderr: 63440 TRACE/DEBUG/INFO lines written to /logs/solve.codex-trace.log']);
  const trace = files['/logs/solve.codex-trace.log'].split('\n').filter(Boolean);
  assert.equal(trace.length, 5);
  assert.equal(trace[2], '… previous line repeated 63436 more times');
  assert.ok(!trace.join('\n').includes(EMAIL) && !trace.join('\n').includes(ACCOUNT), 'no identity in the trace file either');
});

test('continuation lines of a kept WARN record are kept, of a repeated one dropped; output before any record is kept', () => {
  const stderr = createCodexStderrLog({ tracePath: null });
  const warn = minute => `2026-11-18T01:${minute}:00.1Z  WARN codex_core::client: retrying request`;
  const logged = [...stderr.write(`Reading prompt from stdin...\n${warn(10)}\n  body: first\n${warn(11)}\n  body: second\nwarning: a message Codex prints itself\n`), ...stderr.end()];
  assert.deepEqual(logged, ['Reading prompt from stdin...', warn(10), '  body: first', 'warning: a message Codex prints itself', 'ℹ️  Codex stderr: repeated 1 more time: WARN codex_core::client: retrying request']);
});

test('runs of one kept line collapse into a count, and identity is redacted in kept lines', () => {
  const stderr = createCodexStderrLog({ tracePath: null });
  const logged = [...stderr.write(`Error: boom user.email="${EMAIL}"\n`.repeat(5)), ...stderr.write('Error: other\n'), ...stderr.end()];
  assert.deepEqual(logged, ['Error: boom user.email="<redacted>"', 'ℹ️  Codex stderr: previous line repeated 4 more times', 'Error: other']);
});

test('sanitizeLogContent redacts account identifiers before a log is published', async () => {
  const { sanitizeLogContent } = await import('../src/token-sanitization.lib.mjs');
  const published = await sanitizeLogContent(`[STDERR] SyntaxError${TRAILER}`, { skipActiveTokensOutputSanitization: true, warnOnMismatch: false });
  assert.ok(!published.includes(EMAIL), 'email redacted');
  assert.ok(!published.includes(ACCOUNT), 'account id redacted');
  assert.match(published, /user\.email="<redacted>"/);
});
