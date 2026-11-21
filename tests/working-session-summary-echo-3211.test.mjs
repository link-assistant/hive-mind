#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #3211: the "Working session summary" comment
 * published the last tool output as if it were the session's report.
 *
 * Both reproduction runs ended with a final message that only repeated a tool
 * result: claude wrote "The `WebFetch` command completed. Output: …", codex
 * wrote "Read 1 file(s):\n- `.gitkeep`: …". Neither describes what the session
 * did, and published under "Working session summary" both read as completed
 * work. Such a message is replaced by a neutral sentence that says the tool did
 * not summarise, and points to the log.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3211
 * @see https://github.com/link-assistant/hive-mind/issues/2119
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeEchoedToolOutputSummary, replaceEchoedToolOutputSummary } from '../src/working-session-summary.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const claudeEcho = ['The `WebFetch` command completed. Output:', '', '```text', 'Implement Hello World in Kotlin', '```'].join('\n');
const pwdEcho = ['The `pwd` command completed. Output:', '', '```text', '/tmp/gh-issue-solver-1785421161275', '```'].join('\n');
const codexEcho = ['Read 1 file(s):', '- `.gitkeep`: (empty)'].join('\n');

assert.deepEqual(describeEchoedToolOutputSummary(claudeEcho), { tool: 'WebFetch' });
assert.deepEqual(describeEchoedToolOutputSummary(pwdEcho), { tool: 'pwd' });
assert.deepEqual(describeEchoedToolOutputSummary(codexEcho), { tool: 'Read' });
assert.deepEqual(describeEchoedToolOutputSummary('Read 2 file(s):\n- `README.md`: # Title\n\nSome text\n- `.gitkeep`: auto-generated'), { tool: 'Read' }, 'file contents may span lines');

for (const echo of [claudeEcho, pwdEcho, codexEcho]) {
  const replaced = replaceEchoedToolOutputSummary(echo);
  assert.notEqual(replaced, echo);
  assert.match(replaced, /did not write a summary/);
  assert.match(replaced, /session log/);
  assert.doesNotMatch(replaced, /Hello World|gh-issue-solver|\.gitkeep/, 'the echoed output itself is not republished');
}
assert.match(replaceEchoedToolOutputSummary(claudeEcho), /`WebFetch`/, 'the tool whose output was echoed is named');

// A real summary - even one that quotes a command - is kept verbatim.
const realSummaries = ['Implemented Hello World in `Main.kt` and added a test. The `cargo test` command completed. Output: 1 passed.', 'The `cargo test` command completed. Output:\n\n```text\n1 passed\n```\n\nI implemented Hello World in `src/main.rs` and pushed the commit.', '## Summary\n\nRead 3 file(s) and rewrote `Main.kt`.', 'Read 2 file(s):\n- `a.kt`\n- `b.kt`\n\nThen fixed the build in `a.kt` and pushed the commit.'];
for (const summary of realSummaries) {
  assert.equal(describeEchoedToolOutputSummary(summary), null, summary);
  assert.equal(replaceEchoedToolOutputSummary(summary), summary);
}
for (const notText of [null, undefined, '', 42]) assert.equal(replaceEchoedToolOutputSummary(notText), notText);

const results = readFileSync(join(__dirname, '..', 'src', 'solve.results.lib.mjs'), 'utf8');
assert.match(results, /resultSummary = replaceEchoedToolOutputSummary\(resultSummary\)/, 'applied before the summary is posted');

console.log('PASS: issue #3211 an echoed tool output is not published as the working session summary');
