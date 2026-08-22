#!/usr/bin/env node

/**
 * Regression tests for issue #2119: the published "Working session summary".
 *
 * The Kotlin reproduction run posted this comment on a pull request whose diff
 * was empty:
 *
 *     <!-- hive-mind:working-session-summary -->
 *     ## Working session summary
 *
 *     The `pwd` command completed. Output:
 *
 *     ```text
 *     /tmp/gh-issue-solver-1785421161275
 *     ```
 *
 * https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5132013034
 *
 * The AI tool doing nothing is an upstream problem. What Hive Mind owns is that
 * the comment read as a report of completed work and leaked the solver's own
 * workspace path into a public comment.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildNoChangesNotice, redactWorkspacePaths, WORKSPACE_PATH_PLACEHOLDER } from '../src/working-session-summary.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- workspace path redaction ------------------------------------------------

// The verbatim body of the reported comment.
const reportedSummary = ['The `pwd` command completed. Output:', '', '```text', '/tmp/gh-issue-solver-1785421161275', '```'].join('\n');

const redacted = redactWorkspacePaths(reportedSummary);
assert.ok(!redacted.includes('/tmp/gh-issue-solver-1785421161275'), 'the solver workspace path is not published');
assert.ok(redacted.includes(WORKSPACE_PATH_PLACEHOLDER), redacted);
assert.ok(redacted.includes('The `pwd` command completed.'), 'everything else the AI wrote is preserved verbatim');

assert.equal(redactWorkspacePaths('cd /tmp/gh-issue-solver-resume-abc123-999 && ls'), `cd ${WORKSPACE_PATH_PLACEHOLDER} && ls`, 'resume workspaces are redacted too');
assert.equal(redactWorkspacePaths('/private/var/folders/aa/bb/T/gh-issue-solver-42'), WORKSPACE_PATH_PLACEHOLDER, 'the macOS temp directory layout is covered');

// Paths that belong to the user's project must survive untouched.
for (const kept of ['src/solve.mjs', '/home/user/projects/my-repo/src/index.ts', '/tmp/my-own-scratch-file.txt', 'See ./docs/case-studies/issue-2119/README.md']) {
  assert.equal(redactWorkspacePaths(kept), kept, `unrelated path is left alone: ${kept}`);
}

for (const notText of [null, undefined, '', 42]) {
  assert.equal(redactWorkspacePaths(notText), notText, 'non-string input passes through unchanged');
}

// --- the "nothing was implemented" notice ------------------------------------

const emptyStats = { measured: true, hasChanges: false, filesChanged: 0, additions: 0, deletions: 0 };
const notice = buildNoChangesNotice(emptyStats);
assert.ok(notice.includes('no changes'), notice);
assert.ok(notice.startsWith('>'), 'the notice is rendered as a blockquote so it stands out from the AI text');

assert.equal(buildNoChangesNotice({ measured: true, hasChanges: true, filesChanged: 1, additions: 3, deletions: 0 }), '', 'a pull request with changes gets no notice');
assert.equal(buildNoChangesNotice({ measured: false, hasChanges: false, filesChanged: 0, additions: 0, deletions: 0 }), '', 'an unreadable diff must not produce a false "no changes" claim');
assert.equal(buildNoChangesNotice(null), '', 'a summary attached to an issue rather than a pull request gets no notice');

// --- the comment builder must use both ---------------------------------------

const resultsSource = await readFile(path.join(repoRoot, 'src', 'solve.results.lib.mjs'), 'utf8');
assert.ok(resultsSource.includes("await import('./working-session-summary.lib.mjs')"), 'solve.results.lib.mjs imports the helpers');
assert.ok(resultsSource.includes('const summaryBody = formatWorkingSessionSummaryMarkdown(redactWorkspacePaths(resultSummary));'), 'the posted body is redacted and structured text is fenced');
assert.ok(resultsSource.includes('const noChangesNotice = buildNoChangesNotice(changeStats);'), 'the posted body carries the empty-diff notice');
// The call gained a `log` argument in issue #2135, so the probe can report an
// oversized diff; match the shape rather than the exact argument list.
assert.ok(/const changeStats = prNumber \? await getPullRequestChangeStats\(\{ owner, repo, prNumber, \$(, log)? \}\) : null;/.test(resultsSource), 'the diff is measured before the summary is posted');

console.log('PASS: issue #2119 working session summaries are redacted and state when nothing was implemented');
