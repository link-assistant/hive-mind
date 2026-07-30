#!/usr/bin/env node

/**
 * Regression tests for issue #2119: an empty pull request is not a result.
 *
 * Two of the three reproduction runs ended with a pull request whose net diff
 * was empty - the AI tool wrote nothing, so the branch held only the solver's
 * own scaffolding commit and a revert of it:
 *
 *   https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2
 *   https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2
 *
 * Both published a description claiming
 *
 *   ### Changes
 *   - 1 file(s) modified
 *   - 1 line(s) added
 *
 * and the Kotlin one went further and posted "## ✅ Ready to merge ... - No
 * pending changes". Merging that would have closed the issue with nothing
 * implemented, which is the worst kind of false positive: it looks like success.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EMPTY_PULL_REQUEST_BLOCKER, formatChangeSummary, getPullRequestChangeStats } from '../src/pull-request-changes.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A `$` stand-in that returns a fixed diff, so the tests never touch the network.
const fake$ =
  ({ stdout = '', code = 0, throws = false }) =>
  () => {
    if (throws) throw new Error('gh: could not reach the API');
    return Promise.resolve({ code, stdout: Buffer.from(stdout) });
  };

// --- measuring the diff ------------------------------------------------------

// The exact shape of the reproduction PRs: a commit and its revert cancel out,
// so `gh pr diff` prints nothing at all.
const empty = await getPullRequestChangeStats({ owner: 'konard', repo: 'test-hello-world', prNumber: 2, $: fake$({ stdout: '' }) });
assert.equal(empty.measured, true, 'an empty diff was still successfully measured');
assert.equal(empty.hasChanges, false, 'a pull request with an empty net diff has no changes');
assert.equal(empty.filesChanged, 0);

const realDiff = ['diff --git a/examples/hello.scala b/examples/hello.scala', 'new file mode 100644', '--- /dev/null', '+++ b/examples/hello.scala', '@@ -0,0 +1,3 @@', '+object Hello {', '+  def main(args: Array[String]): Unit = println("Hello, World!")', '+}'].join('\n');
const changed = await getPullRequestChangeStats({ owner: 'konard', repo: 'test-hello-world', prNumber: 2, $: fake$({ stdout: realDiff }) });
assert.equal(changed.hasChanges, true, 'a pull request that adds a file has changes');
assert.equal(changed.filesChanged, 1);
assert.equal(changed.additions, 3, 'the `+++ b/...` header is not counted as an added line');

// An unreachable API must never be mistaken for "nothing changed" - that would
// turn a transient network failure into an endless restart loop.
for (const broken of [fake$({ code: 1 }), fake$({ throws: true })]) {
  const stats = await getPullRequestChangeStats({ owner: 'konard', repo: 'test-hello-world', prNumber: 2, $: broken });
  assert.equal(stats.measured, false, 'a failed diff read is reported as unmeasured');
  assert.equal(stats.hasChanges, false, 'unmeasured stats claim no changes, so callers must gate on `measured`');
}

// --- the published description ----------------------------------------------

assert.equal(formatChangeSummary(empty), '- No files were changed by this pull request yet', 'the description states the diff is empty instead of inventing a file count');
assert.ok(!formatChangeSummary(empty).includes('1 file(s) modified'), 'the false positive from the reproduction PRs is gone');

const summary = formatChangeSummary(changed);
assert.ok(summary.includes('- 1 file(s) modified'), summary);
assert.ok(summary.includes('- 3 line(s) added'), summary);

const unavailable = formatChangeSummary({ measured: false, hasChanges: false, filesChanged: 0, additions: 0, deletions: 0 });
assert.ok(unavailable.includes('could not be read'), 'an unreadable diff is reported as unknown, not as empty');

// --- the callers must actually use it ----------------------------------------

const autoMergeSource = await readFile(path.join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
assert.ok(autoMergeSource.includes("await import('./pull-request-changes.lib.mjs')"), 'the auto-merge watcher measures the diff');
assert.ok(autoMergeSource.includes('const isEmptyPullRequest = changeStats.measured && !changeStats.hasChanges'), 'an unmeasured diff does not count as empty');
assert.ok(/!hasUncommittedChanges && !isEmptyPullRequest/.test(autoMergeSource), 'the "ready to merge" branch is gated on the pull request not being empty');
assert.ok(autoMergeSource.includes('EMPTY_PULL_REQUEST_BLOCKER'), 'an empty pull request is reported as a restart reason');

const resultsSource = await readFile(path.join(repoRoot, 'src', 'solve.results.lib.mjs'), 'utf8');
assert.ok(resultsSource.includes('formatChangeSummary(changeStats)'), 'the generated description renders the shared change summary');
assert.ok(!/- \$\{filesChanged\} file\(s\) modified/.test(resultsSource), 'the old unconditional file count is gone');

assert.ok(EMPTY_PULL_REQUEST_BLOCKER.includes('net diff is empty'), EMPTY_PULL_REQUEST_BLOCKER);

console.log('PASS: issue #2119 empty pull requests are neither described as changes nor reported as ready to merge');
