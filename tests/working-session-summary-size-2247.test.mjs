#!/usr/bin/env node

/**
 * Regression coverage for issue #2247 (H8).
 *
 * The working session summary comment republishes the AI tool's last message
 * verbatim. On the Scala run's pull request
 * (konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b#2) that message
 * was a Formal AI plan record whose `goal` field embedded the entire request
 * prompt, so the comment carried 13624 bytes of machine text
 * (https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2#issuecomment-5284660663),
 * and one such comment was posted per session - six on that single pull
 * request. Reading the conversation meant scrolling through the run's own input
 * to reach its output.
 *
 * The fix folds an oversized summary into a `<details>` block, keeps a few
 * visible lines, and leaves the overflow to the session log. It must not touch
 * the summaries that are already readable: the six 2026-09-13 comments on the
 * same pull request are 542 bytes each and are published unchanged.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { capWorkingSessionSummary, SUMMARY_DETAILS_CHARACTERS, SUMMARY_VISIBLE_CHARACTERS, SUMMARY_VISIBLE_LINES } from '../src/working-session-summary.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const FENCE = '`'.repeat(3);

// ---------------------------------------------------------------------------
// 1. A readable summary is published exactly as the AI wrote it.
// ---------------------------------------------------------------------------

// The 2026-09-13 Scala summary, as posted (comment 5655468757, 542 bytes with
// its markers). Nothing about it is folded.
const SCALA_SUMMARY = ['Created and verified `Main.scala` through the agentic CLI harness.', '', `${FENCE}scala`, 'object Main {', '  def main(args: Array[String]): Unit = {', '    println("Hello, world!")', '  }', '}', FENCE, '', 'Commands executed by the harness:', '- `scalac Main.scala`', '- `scala Main`', '', 'Actual tool output:', '', `${FENCE}text`, '/bin/sh: 1: scala: not found', FENCE].join('\n');

{
  const capped = capWorkingSessionSummary(SCALA_SUMMARY, { visibleLines: 32 });
  assert.equal(capped.folded, false, 'a short summary is not folded');
  assert.equal(capped.body, SCALA_SUMMARY, 'and it is published byte for byte');
  assert.equal(capped.omittedCharacters, 0);
}

for (const empty of ['', null, undefined]) {
  const capped = capWorkingSessionSummary(empty);
  assert.equal(capped.folded, false);
  assert.equal(capped.body, empty, 'nothing to cap is not an error');
}

// ---------------------------------------------------------------------------
// 2. The 13 KB plan record is folded, and the overflow goes to the log.
// ---------------------------------------------------------------------------

// The shape of the record that was posted: a short lead-in, then a `goal` field
// holding the whole prompt on one enormous line.
const PLAN_RECORD = ['Planned, not executed: https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/issues/1.', '', 'Nothing the request names was changed.', '', `${FENCE}text`, 'general_change_plan', '  id "repository_work_item_plan_55a8ccb3fb83cbb0"', '  execution_mode "repository_work_item"', '  terminal_state "planned_not_executed"', `  goal "${'You are an AI issue solver. '.repeat(500)}"`, '  target "https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/issues/1"', FENCE].join('\n');

assert.ok(PLAN_RECORD.length > 13000, 'the fixture is the size of the reported comment');

{
  const capped = capWorkingSessionSummary(PLAN_RECORD);
  assert.equal(capped.folded, true);
  assert.ok(capped.body.length < PLAN_RECORD.length / 2, `13 KB became ${capped.body.length} characters`);
  assert.ok(capped.body.startsWith('Planned, not executed:'), 'the first lines stay visible');
  assert.ok(capped.body.includes('<details>') && capped.body.includes('</details>'), 'the rest is collapsed');
  assert.ok(capped.omittedCharacters > 0, 'the tail beyond the details cap is dropped');
  assert.match(capped.body, /is not shown here; the full session output is in the session log attached to this pull request\./, 'the reader is told where the rest is');
  assert.ok(!capped.body.includes('You are an AI issue solver. '.repeat(200)), 'the embedded prompt is not republished in full');
}

{
  // When the log has already been uploaded, the overflow note links it.
  const logUrl = 'https://gist.github.com/konard/97b2139c89465d6b3679db3b62a82539';
  const capped = capWorkingSessionSummary(PLAN_RECORD, { logUrl });
  assert.ok(capped.body.includes(`[session log](${logUrl})`), 'the gist is linked for the rest');
}

// ---------------------------------------------------------------------------
// 3. The folded comment is still valid Markdown.
// ---------------------------------------------------------------------------

{
  // The head cut in the middle of a code fence must not leave it open, or the
  // `<details>` block that follows renders as code.
  const openFence = [`${FENCE}text`, ...Array.from({ length: 40 }, (unused, index) => `line ${index}`), FENCE].join('\n');
  const capped = capWorkingSessionSummary(openFence);
  assert.equal(capped.folded, true);
  const head = capped.body.slice(0, capped.body.indexOf('<details>'));
  assert.equal((head.match(/^`{3}/gmu) || []).length % 2, 0, 'the head closes every fence it opens');
}

{
  // A summary that contains a fence of its own must not close the fence that
  // quotes it inside the `<details>` block.
  const nested = ['lead in', '', ...Array.from({ length: 30 }, () => 'filler line'), `${FENCE}js`, 'console.log(1);', FENCE].join('\n');
  const capped = capWorkingSessionSummary(nested, { visibleLines: 4 });
  const details = capped.body.slice(capped.body.indexOf('<details>'));
  assert.ok(details.includes('````text'), 'the quoting fence is longer than anything it quotes');
  assert.ok(details.includes('console.log(1);'), 'and the quoted content survives intact');
}

{
  // Line count alone is enough to fold: one-line-per-command tool output.
  const manyLines = Array.from({ length: SUMMARY_VISIBLE_LINES + 5 }, (unused, index) => `step ${index}`).join('\n');
  assert.ok(manyLines.length < SUMMARY_VISIBLE_CHARACTERS, 'this fixture is small but tall');
  assert.equal(capWorkingSessionSummary(manyLines).folded, true);
  assert.equal(capWorkingSessionSummary(manyLines, { visibleLines: SUMMARY_VISIBLE_LINES + 5 }).folded, false);
}

assert.ok(SUMMARY_DETAILS_CHARACTERS > SUMMARY_VISIBLE_CHARACTERS, 'the collapsed block holds more than the visible head');

// ---------------------------------------------------------------------------
// 4. The comment builder applies the cap.
// ---------------------------------------------------------------------------

const resultsSource = await readFile(join(repoRoot, 'src', 'solve.results.lib.mjs'), 'utf8');
assert.ok(resultsSource.includes('capWorkingSessionSummary'), 'attachSolutionSummary caps the summary it publishes');
assert.ok(/capWorkingSessionSummary\(formatWorkingSessionSummaryMarkdown\(redactWorkspacePaths\(resultSummary\)\), \{ logUrl \}\)/.test(resultsSource), 'the cap is applied after redaction and formatting, so the visible head is the published text');
assert.ok(resultsSource.includes('const summaryBody = capped.body;'), 'and the capped body is what goes into the comment');

console.log('PASS: issue #2247 (H8) working session summary size cap');
