#!/usr/bin/env node

/**
 * Regression tests for issue #2211: the solver placeholder must never be merged,
 * and a pull request that only touches it must not look like a change.
 *
 * https://github.com/konard/audio-decomposer/pull/3 was merged with this diff -
 * and nothing else:
 *
 *   diff --git a/.gitkeep b/.gitkeep
 *   @@ -1,3 +1,4 @@
 *    # .gitkeep file auto-generated at 2026-08-20T05:02:39.661Z for PR creation ...
 *    # Updated: 2026-08-22T18:48:37.899Z
 *   -# Updated: 2026-08-30T18:52:16.784Z
 *   +# Updated: 2026-08-30T18:52:16.784Z
 *   +# Updated: 2026-08-30T19:20:07.327Z
 *
 * Two bugs met there:
 *
 * 1. `cleanupClaudeFile()` ran AFTER the auto-merge watch loop, so the revert
 *    lost a race it could not win. On that branch:
 *      19:20:07  Initial commit with task details          (.gitkeep touched)
 *      19:28:09  Merge pull request #3                     (.gitkeep on main)
 *      19:28:13  Revert "Initial commit with task details"  <- 4 seconds late
 *    The same leak is visible on the template repository this one was generated
 *    from: `.gitkeep` on its default branch had accumulated eight solver lines
 *    from eight merged pull requests (docs/case-studies/issue-2211).
 *
 * 2. The empty-pull-request detector from issue #2119 only recognised a
 *    placeholder that was *created* by the solver (`+# .gitkeep file
 *    auto-generated at ...`). When the file already existed the solver appends
 *    `# Updated: <timestamp>` instead, so the diff was a plain modification and
 *    the watcher merged it as if the AI had implemented something.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPullRequestChangeStats } from '../src/pull-request-changes.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const caseData = path.join(repoRoot, 'docs', 'case-studies', 'issue-2211', 'data');

const fake$ = stdout => () => Promise.resolve({ code: 0, stdout: Buffer.from(stdout) });
const measure = stdout => getPullRequestChangeStats({ owner: 'konard', repo: 'audio-decomposer', prNumber: 3, $: fake$(stdout) });

// --- the archived diffs of the pull requests from the report -----------------

for (const prNumber of [2, 3]) {
  const diff = await readFile(path.join(caseData, 'audio-decomposer', `pr-${prNumber}.diff`), 'utf8');
  const stats = await measure(diff);
  assert.equal(stats.measured, true, `PR #${prNumber}: the diff was read`);
  assert.equal(stats.hasChanges, false, `PR #${prNumber}: appending a solver timestamp to .gitkeep is not a change`);
  assert.equal(stats.filesChanged, 0, `PR #${prNumber}: GitHub says "1 file(s) modified", we must not`);
  assert.equal(stats.additions, 0, `PR #${prNumber}: the solver's own bookkeeping lines are not additions`);
  assert.equal(stats.deletions, 0, `PR #${prNumber}: nor deletions`);
  assert.equal(stats.placeholderOnly, true, `PR #${prNumber}: this is a placeholder-only pull request`);
  assert.equal(stats.placeholderSections, 1, `PR #${prNumber}: the caller can see a placeholder is still in the diff`);
}

// --- every shape the placeholder writer can produce --------------------------

const GENERATED = '# .gitkeep file auto-generated at 2026-08-20T05:02:39.661Z for PR creation at branch issue-136-1491df405bd1 for issue https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/136';

// A brand new `.gitkeep` (the case issue #2119 already covered).
const created = await measure(['diff --git a/.gitkeep b/.gitkeep', 'new file mode 100644', '--- /dev/null', '+++ b/.gitkeep', '@@ -0,0 +1 @@', `+${GENERATED}`].join('\n'));
assert.equal(created.hasChanges, false, 'a freshly written .gitkeep placeholder is not a change');
assert.equal(created.placeholderSections, 1);

// A `.gitkeep` that already held the generated line and got one `# Updated:`.
const appendedOnce = await measure(['diff --git a/.gitkeep b/.gitkeep', 'index d05321d..0addba9 100644', '--- a/.gitkeep', '+++ b/.gitkeep', '@@ -1 +1,2 @@', `-${GENERATED}`, '\\ No newline at end of file', `+${GENERATED}`, '+# Updated: 2026-08-22T18:48:37.899Z', '\\ No newline at end of file'].join('\n'));
assert.equal(appendedOnce.hasChanges, false, 'the first `# Updated:` append is not a change');
assert.equal(appendedOnce.placeholderOnly, true);

// A `.gitkeep` the repository owns, that the solver then appended to. The
// owner's line survives on both sides, so this is still not the AI's work.
const ownedThenAppended = await measure(['diff --git a/.gitkeep b/.gitkeep', 'index 1111111..2222222 100644', '--- a/.gitkeep', '+++ b/.gitkeep', '@@ -1 +1,2 @@', ' keep this directory', '+# Updated: 2026-08-30T19:20:07.327Z'].join('\n'));
assert.equal(ownedThenAppended.hasChanges, false, 'appending a solver timestamp to a repository-owned .gitkeep is not a change');
assert.equal(ownedThenAppended.placeholderSections, 1);

// A real edit to `.gitkeep` next to the solver's line is real work.
const realGitkeepEdit = await measure(['diff --git a/.gitkeep b/.gitkeep', 'index 1111111..2222222 100644', '--- a/.gitkeep', '+++ b/.gitkeep', '@@ -1,2 +1,2 @@', ` ${GENERATED}`, '-keep this directory', '+keep this directory for generated audio'].join('\n'));
assert.equal(realGitkeepEdit.hasChanges, true, 'a human-meaningful line in .gitkeep is a change');
assert.equal(realGitkeepEdit.filesChanged, 1);
assert.equal(realGitkeepEdit.placeholderSections, 0);

// The CLAUDE.md placeholder, both created and appended to an existing file.
const claudeTask = ['Issue to solve: https://github.com/konard/audio-decomposer/issues/1', 'Your prepared branch: issue-1-ead1e9e3d5f7', 'Your prepared working directory: /tmp/gh-issue-solver-1', 'Proceed.', 'Run timestamp: 2026-08-30T19:20:07.327Z'];
const claudeCreated = await measure(['diff --git a/CLAUDE.md b/CLAUDE.md', 'new file mode 100644', '--- /dev/null', '+++ b/CLAUDE.md', `@@ -0,0 +1,${claudeTask.length} @@`, ...claudeTask.map(line => `+${line}`)].join('\n'));
assert.equal(claudeCreated.hasChanges, false, 'a freshly written CLAUDE.md placeholder is not a change');

const claudeAppended = await measure(['diff --git a/CLAUDE.md b/CLAUDE.md', 'index 1111111..2222222 100644', '--- a/CLAUDE.md', '+++ b/CLAUDE.md', '@@ -1,2 +1,9 @@', ' # Project guidelines', ' Run `cargo test` before committing.', '+', '+---', '+', ...claudeTask.map(line => `+${line}`)].join('\n'));
assert.equal(claudeAppended.hasChanges, false, "the solver's task block appended to a project's CLAUDE.md is not a change");
assert.equal(claudeAppended.placeholderOnly, true);

const claudeRealEdit = await measure(['diff --git a/CLAUDE.md b/CLAUDE.md', 'index 1111111..2222222 100644', '--- a/CLAUDE.md', '+++ b/CLAUDE.md', '@@ -1,2 +1,2 @@', ' # Project guidelines', '-Run `cargo test` before committing.', '+Run `cargo test --all` before committing.'].join('\n'));
assert.equal(claudeRealEdit.hasChanges, true, 'an edit to the project guidelines is a change');
assert.equal(claudeRealEdit.placeholderSections, 0);

// A pull request that implemented something and still carries the placeholder:
// the work counts, and the caller is told the placeholder is there to clean up.
const realDiff = ['diff --git a/src/decompose.rs b/src/decompose.rs', 'new file mode 100644', '--- /dev/null', '+++ b/src/decompose.rs', '@@ -0,0 +1,2 @@', '+pub fn decompose() {}', '+'].join('\n');
const prDiff3 = await readFile(path.join(caseData, 'audio-decomposer', 'pr-3.diff'), 'utf8');
const mixed = await measure(`${prDiff3}\n${realDiff}`);
assert.equal(mixed.hasChanges, true, 'the placeholder never hides real work');
assert.equal(mixed.filesChanged, 1, 'only the real file is counted');
assert.equal(mixed.placeholderOnly, false);
assert.equal(mixed.placeholderSections, 1, 'the leftover placeholder is still reported so it can be reverted before merging');

// --- the placeholder is reverted before the merge can happen -----------------

const solveSource = await readFile(path.join(repoRoot, 'src', 'solve.mjs'), 'utf8');
const cleanupPos = solveSource.indexOf('await cleanupClaudeFile(tempDir, branchName, claudeCommitHash, argv)');
const verifyPos = solveSource.indexOf('const verifyResult = await verifyResults(');
const watchPos = solveSource.indexOf('startAutoRestartUntilMergeable(');
assert.ok(cleanupPos > 0 && verifyPos > 0 && watchPos > 0, 'solve.mjs still has the three ordering anchors');
assert.ok(cleanupPos > verifyPos, 'issue #1516: the placeholder is reverted after the AI has reported its results');
assert.ok(cleanupPos < watchPos, 'issue #2211: the placeholder is reverted BEFORE the auto-merge watch loop can merge it');

const autoMergeSource = await readFile(path.join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
assert.ok(autoMergeSource.includes('changeStats.placeholderSections > 0'), 'the watch loop notices a placeholder that survived into its diff');
assert.ok(autoMergeSource.includes("await import('./solve.results.lib.mjs')"), 'the watch loop reverts it instead of merging it');

console.log('PASS: issue #2211 the solver placeholder is detected in every shape and reverted before the merge');
