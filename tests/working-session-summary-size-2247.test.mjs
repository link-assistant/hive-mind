#!/usr/bin/env node

/**
 * Regression coverage for issue #2247 (H8) as revised by issue #2492.
 *
 * #2247 folded any summary longer than 16 lines into a
 * "Rest of the working session summary" `<details>` block. #2492 asked for the
 * whole summary to be shown at all times
 * (https://github.com/link-assistant/hive-mind/pull/2493#issuecomment-5980860458
 * hid most of its summary behind that fold). The summary is now published in
 * full; it is cut only when GitHub could not post it (65536-character limit),
 * and the reader is pointed to the session log for the rest.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { capWorkingSessionSummary, SUMMARY_MAX_CHARACTERS } from '../src/working-session-summary.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const FENCE = '`'.repeat(3);

// ---------------------------------------------------------------------------
// 1. Summaries are published exactly as the AI wrote them - never folded.
// ---------------------------------------------------------------------------

const SCALA_SUMMARY = ['Created and verified `Main.scala` through the agentic CLI harness.', '', `${FENCE}scala`, 'object Main {', '  def main(args: Array[String]): Unit = {', '    println("Hello, world!")', '  }', '}', FENCE].join('\n');

// The shape of the #2492 summary: ~40 lines, a nested fence, about 3 KB.
const LONG_SUMMARY = ['## Final summary', '', ...Array.from({ length: 30 }, (unused, index) => `- point ${index}: ${'detail '.repeat(10)}`), '', `${FENCE}text`, 'During cleanup I briefly deleted the tracked `ci-logs/` directory by mistake.', FENCE].join('\n');

// The 13 KB plan record from #2247 also stays whole: it fits in a comment.
const PLAN_RECORD = ['Planned, not executed.', '', `${FENCE}text`, 'general_change_plan', `  goal "${'You are an AI issue solver. '.repeat(500)}"`, FENCE].join('\n');

for (const summary of [SCALA_SUMMARY, LONG_SUMMARY, PLAN_RECORD]) {
  const capped = capWorkingSessionSummary(summary);
  assert.equal(capped.truncated, false);
  assert.equal(capped.body, summary, 'the summary is published byte for byte');
  assert.equal(capped.omittedCharacters, 0);
  assert.ok(!capped.body.includes('<details>'), 'nothing is folded');
  assert.ok(!capped.body.includes('Rest of the working session summary'), 'no "Rest of" block');
}

for (const empty of ['', null, undefined]) {
  const capped = capWorkingSessionSummary(empty);
  assert.equal(capped.truncated, false);
  assert.equal(capped.body, empty, 'nothing to cap is not an error');
}

// ---------------------------------------------------------------------------
// 2. Only a summary GitHub would reject is cut, and the cut is valid Markdown.
// ---------------------------------------------------------------------------

assert.ok(SUMMARY_MAX_CHARACTERS < 65536, "the cap leaves room for the heading and footer under GitHub's limit");

{
  const huge = [`${FENCE}text`, ...Array.from({ length: 5000 }, (unused, index) => `line ${index} ${'x'.repeat(20)}`), FENCE].join('\n');
  assert.ok(huge.length > SUMMARY_MAX_CHARACTERS);
  const capped = capWorkingSessionSummary(huge);
  assert.equal(capped.truncated, true);
  assert.ok(capped.omittedCharacters > 0);
  assert.ok(capped.body.length < 65536 - 1000, 'the comment still fits');
  assert.ok(!capped.body.includes('<details>'), 'the shown part is not folded');
  assert.equal((capped.body.match(/^`{3}/gmu) || []).length % 2, 0, 'the cut closes the fence it left open');
  assert.match(capped.body, /more does not fit in a GitHub comment; the full session output is in the session log attached to this pull request\.$/);

  const logUrl = 'https://gist.github.com/konard/97b2139c89465d6b3679db3b62a82539';
  assert.ok(capWorkingSessionSummary(huge, { logUrl }).body.includes(`[session log](${logUrl})`), 'the gist is linked for the rest');
}

// ---------------------------------------------------------------------------
// 3. The comment builder applies the cap.
// ---------------------------------------------------------------------------

const resultsSource = await readFile(join(repoRoot, 'src', 'solve.results.lib.mjs'), 'utf8');
assert.ok(/capWorkingSessionSummary\(formatWorkingSessionSummaryMarkdown\(redactWorkspacePaths\(resultSummary\)\), \{ logUrl \}\)/.test(resultsSource), 'the cap is applied after redaction and formatting');
assert.ok(resultsSource.includes('const summaryBody = capped.body;'), 'and the capped body is what goes into the comment');

const librarySource = await readFile(join(repoRoot, 'src', 'working-session-summary.lib.mjs'), 'utf8');
assert.ok(!librarySource.includes('<summary>Rest of'), 'the "Rest of the working session summary" fold is gone');

console.log('PASS: issue #2247/#2492 working session summary is shown in full');
