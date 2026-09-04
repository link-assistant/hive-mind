#!/usr/bin/env node

/**
 * Issue #2119: does the pull request actually contain any changes?
 *
 * Nobody asked that question before, and two separate false positives followed
 * from it. In the reproduction runs the AI tool produced nothing, so the branch
 * ended up with the solver's own scaffolding commit and a revert of it - a net
 * diff of zero files:
 *
 *   https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2
 *   https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2
 *
 * Yet the published pull request bodies claimed
 *
 *   ### Changes
 *   - 1 file(s) modified
 *   - 1 line(s) added
 *
 * (the stats were measured while the scaffolding commit was still in the diff
 * and never revisited), and the Kotlin run went on to post "✅ Ready to merge -
 * No pending changes" for a pull request that changed nothing at all.
 *
 * The third reproduction run failed before the AI committed anything, so its
 * pull request kept the scaffolding file itself:
 *
 *   https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2
 *   .gitkeep | 1 +
 *
 * That is the same "nothing was implemented" state wearing a file count, so the
 * solver's own placeholder is excluded from the counts here rather than being
 * reported as the AI's work.
 *
 * This module is the single place that answers the question, so both the
 * description writer and the mergeability watcher agree.
 */

import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { quietProbe } from './quiet-probe.lib.mjs';

/**
 * Size at which a pull-request diff is worth complaining about (issue #2135).
 *
 * A diff this large is never the AI's source change: in the captured run it was
 * CI logs and the solver's own development log committed into the branch. The
 * warning is the early signal that was missing while the log grew to 286 MB.
 */
const LARGE_DIFF_WARNING_BYTES = 8 * 1024 * 1024;

/**
 * The solver's own scaffolding files, recognised by the content it writes into
 * them (`src/solve.auto-pr.lib.mjs`). A pull request whose whole diff is one of
 * these contains no solution: the placeholder exists only to give an empty
 * branch something to open a pull request from, and is reverted once the AI
 * commits real work.
 *
 * Matching on content, not on the file name, keeps a repository's own
 * `.gitkeep` or `CLAUDE.md` edits counted as the real changes they are.
 */
const PLACEHOLDER_CONTENT_PATTERNS = new Map([
  ['.gitkeep', [/^\+#\s*\.gitkeep file auto-generated at .+ for PR creation at branch /m]],
  ['CLAUDE.md', [/^\+Issue to solve: \S+/m, /^\+Your prepared branch: \S+/m]],
]);

/**
 * Measure a unified diff in a single pass.
 *
 * Issue #2135: the previous implementation split the whole diff into an array
 * of lines, concatenated every line back into a per-file `body` string, and
 * then counted additions with `body.match(/^\+[^+]/gm)` - a regex whose result
 * is an array holding one string per added line. For the 60 MB pull-request
 * diff captured in that run (the AI had committed CI logs and the solver's own
 * development log into the branch) those three copies of the diff, plus a
 * multi-million-entry match array, were a large part of the heap that ended the
 * session with `FATAL ERROR: Reached heap limit`.
 *
 * This pass keeps no copy of the diff: it walks the string by line offsets,
 * counts as it goes, and retains section text only for the two paths that can
 * possibly be the solver's placeholder.
 *
 * The counting rules are unchanged: a line is an addition when it starts with
 * `+` followed by a character other than `+` (so the `+++ b/path` header is not
 * counted), and a deletion when it starts with `-` followed by a character
 * other than `-`. Lines before the first `diff --git` header belong to no file
 * and are ignored, exactly as they were when sections were built by splitting.
 *
 * @param {string} diff - unified diff text, possibly empty.
 * @returns {{filesChanged: number, additions: number, deletions: number, placeholderSections: number}}
 */
const measureDiff = diff => {
  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;
  let placeholderSections = 0;
  let section = null;

  const closeSection = () => {
    if (!section) return;
    const isPlaceholder = Boolean(section.patterns) && section.patterns.every(pattern => pattern.test(section.body));
    if (isPlaceholder) placeholderSections += 1;
    else {
      filesChanged += 1;
      additions += section.additions;
      deletions += section.deletions;
    }
    section = null;
  };

  for (let start = 0; start < diff.length;) {
    let end = diff.indexOf('\n', start);
    if (end === -1) end = diff.length;
    const line = diff.slice(start, end);
    start = end + 1;

    if (line.startsWith('diff --git ')) {
      closeSection();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const path = match ? match[2] : '';
      const patterns = PLACEHOLDER_CONTENT_PATTERNS.get(path) || null;
      section = { patterns, body: '', additions: 0, deletions: 0 };
      continue;
    }
    if (!section) continue;
    // Only a placeholder candidate needs its text kept; every other file is
    // reduced to two counters as it streams past.
    if (section.patterns) section.body += `${line}\n`;
    if (line.length > 1) {
      if (line[0] === '+' && line[1] !== '+') section.additions += 1;
      else if (line[0] === '-' && line[1] !== '-') section.deletions += 1;
    }
  }
  closeSection();

  return { filesChanged, additions, deletions, placeholderSections };
};

/**
 * Measure the net diff of a pull request.
 *
 * The counts come from the unified diff rather than from the PR's `additions` /
 * `deletions` fields because those are per-commit sums: a commit and its revert
 * report 1 addition and 1 deletion while the net diff is empty.
 *
 * @param {Object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {Function} params.$ command-stream tagged-template executor
 * @param {Function} [params.log] - optional logger for the size diagnostic
 * @returns {Promise<{hasChanges: boolean, filesChanged: number, additions: number, deletions: number, placeholderOnly: boolean, measured: boolean, diffBytes: number}>}
 *   The counts cover the AI's own work: the solver's placeholder file is
 *   excluded and reported through `placeholderOnly` instead. `measured` is
 *   false when the diff could not be fetched, in which case callers must not
 *   treat the pull request as empty. `diffBytes` is the size of the diff that
 *   was measured, so a caller can see a runaway pull request growing.
 */
export const getPullRequestChangeStats = async ({ owner, repo, prNumber, $, log = null }) => {
  let diffOutput = '';
  let measured = false;
  try {
    // Issue #2135: `mirror: false`. This diff is read to answer one yes/no
    // question, and every caller reports the answer in words - but it was being
    // echoed into the log that the solver then attaches to the pull request and
    // (with --development-log) commits into the branch, which put the previous
    // copy of the diff inside the next one. Seven such copies grew one session
    // log to 286 MB and ended it with a V8 out-of-memory abort.
    const result = await ghWithRateLimitRetry(() => quietProbe($)`gh pr diff ${prNumber} --repo ${owner}/${repo}`, { label: `pr diff ${owner}/${repo}#${prNumber}` });
    if (result.code === 0) {
      diffOutput = result.stdout.toString();
      measured = true;
    }
  } catch {
    // Leave measured false: an unreachable API must not read as "no changes".
  }

  const { filesChanged, additions, deletions, placeholderSections } = measureDiff(diffOutput);
  const diffBytes = diffOutput.length;

  if (measured && diffBytes >= LARGE_DIFF_WARNING_BYTES && typeof log === 'function') {
    // Always megabytes: the threshold itself is 8 MB, so no unit choice is needed.
    await log(`⚠️  Pull request #${prNumber} diff is ${(diffBytes / (1024 * 1024)).toFixed(1)} MB - measuring it is slow and memory-hungry; check whether logs or build output were committed to the branch`, { level: 'warning' });
  }

  return {
    hasChanges: filesChanged > 0,
    filesChanged,
    additions,
    deletions,
    placeholderOnly: filesChanged === 0 && placeholderSections > 0,
    measured,
    diffBytes,
  };
};

/**
 * Render the "### Changes" section of a generated pull request description.
 *
 * When the diff is empty this says so instead of inventing a file count, so a
 * reviewer reading the description learns the same thing the diff would tell
 * them.
 *
 * @param {{hasChanges: boolean, filesChanged: number, additions: number, deletions: number, measured: boolean}} stats
 * @returns {string}
 */
export const formatChangeSummary = stats => {
  if (!stats.measured) {
    return '- The diff could not be read, so the change summary is unavailable';
  }
  if (!stats.hasChanges) {
    if (stats.placeholderOnly) {
      return '- No files were changed by this pull request yet (it contains only the placeholder file the solver commits to open a pull request)';
    }
    return '- No files were changed by this pull request yet';
  }
  return [`- ${stats.filesChanged} file(s) modified`, `- ${stats.additions} line(s) added`, `- ${stats.deletions} line(s) removed`].join('\n');
};

/**
 * The blocker to report when a pull request is otherwise mergeable but empty.
 *
 * Merging it would close the issue without changing anything, so this is
 * treated as a reason to restart the AI rather than as success. The shared
 * auto-restart budget bounds the retries and fails the run visibly once it is
 * exhausted.
 */
export const EMPTY_PULL_REQUEST_BLOCKER = 'The pull request contains no changes (its net diff is empty), so there is nothing to merge';

/**
 * The same blocker, naming the placeholder when that is all the diff contains.
 *
 * @param {{placeholderOnly?: boolean}|null} stats
 * @returns {string}
 */
export const buildEmptyPullRequestBlocker = (stats = null) => (stats?.placeholderOnly ? 'The pull request contains only the placeholder file the solver commits to open a pull request, so there is nothing to merge' : EMPTY_PULL_REQUEST_BLOCKER);

export default { getPullRequestChangeStats, formatChangeSummary, EMPTY_PULL_REQUEST_BLOCKER, buildEmptyPullRequestBlocker };
