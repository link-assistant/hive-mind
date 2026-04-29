---
'@link-assistant/hive-mind': patch
---

Fix misleading `/merge` verbose logs that read as "no CI configured" when CI was actually
running — addresses issue [#1712](https://github.com/link-assistant/hive-mind/issues/1712)
where a user mistakenly Ctrl+C'd the auto-restart-until-mergeable watcher after seeing:

```
[VERBOSE] /merge: PR #83 has no CI checks yet - treating as no_checks
[VERBOSE] /merge: PR #83 has no CI check-runs yet, but 1 workflow run(s) were triggered ...
  ⏳ Waiting for CI:         Build and Release Docker Image
```

The classification logic was correct — `/merge` was waiting on the legitimate 30-120s gap
between GitHub registering a `workflow_run` and publishing the corresponding `check_runs`.
The wording was the bug: "no CI checks yet" is parseable as "this repo has no CI", and the
listing showed run IDs without URLs, so the user couldn't quickly verify what `/merge` was
watching.

Changes:

- **`src/github-merge.lib.mjs`** — `getDetailedCIStatus` and `checkPRCIStatus` reword the
  `no_checks` verbose lines to "has no check-runs or commit statuses registered yet",
  including the short SHA. `getWorkflowRunsForSha` now appends `run.html_url` to every
  entry. Normalized check-run / commit-status entries carry an `html_url` field
  (falling back to `details_url` / `target_url`).
- **`src/solve.auto-merge-helpers.lib.mjs::getMergeBlockers`** — the `no_checks`,
  `pending`, and `cancelled` branches now produce blocker `details` strings of the form
  `"<name> [<status>] — <html_url>"`. The user-facing `⏳ Waiting for CI: …` line in
  `solve.auto-merge.lib.mjs` (which joins `details` with commas) automatically picks up
  the URLs, so the user can click through to the run.
- **`tests/test-misleading-merge-logs-1712.mjs`** — 13 unit tests covering the wording
  guard, blocker enrichment for the no_checks / pending / cancelled paths, regression
  guard for #1466, and the joined user-facing line format.
- **`docs/case-studies/issue-1712/README.md`** — full case study with raw logs, timeline,
  root cause, fix description, and verification on the original PR
  [link-foundation/box#83](https://github.com/link-foundation/box/pull/83) (which CI
  passed for, after the user killed the watcher prematurely).

Also extends the `useWithRetry` helper (originally added in #1710 to recover from corrupt
hosted-CI npm-install state) with a third failure mode: `ERR_INVALID_PACKAGE_CONFIG` —
seen in this branch's own CI run when Node refused to parse a truncated
`getenv-v-latest/package.json`. `src/queue-config.lib.mjs` now loads `getenv` and
`links-notation` through the retry wrapper, matching `config.lib.mjs` and `lino.lib.mjs`.
Three new unit tests in `tests/test-use-with-retry.mjs` cover the new mode.

No upstream issue is needed — the bug was entirely in `link-assistant/hive-mind`. The
external workflow finished successfully (`check-runs-dfc4c14.json` shows `total_count: 22`).

**Follow-up round** (after review feedback in
[PR #1713 comment](https://github.com/link-assistant/hive-mind/pull/1713#issuecomment-4342387674)):

- **List active runs across ALL PR commits, not just HEAD.** New
  `getActivePRWorkflowRuns()` in `src/github-merge-repo-actions.lib.mjs` walks every
  commit on the PR (`/repos/.../pulls/N/commits`), dedupes by `run.id`, returns groups
  marked `head` / `older`. The verbose log now lists active runs on older commits under
  per-commit URL headers, so the GitHub Actions tab (which shows yellow dots for older
  commits) reconciles with the log.
- **Eliminate duplicate logging.** `getWorkflowRunsForSha(verbose=true)` already prints
  every run; the no_checks branch no longer re-iterates `workflowRuns`, just emits a
  single explanatory summary line.
- **Commit URLs instead of short SHAs.** Verbose lines that referenced
  `${sha.substring(0, 7)}` now use `https://github.com/${owner}/${repo}/commit/${sha}`
  (or `/pull/N/commits/${sha}` where the PR context matters).
- **Inline plain-English explanations.** New `STATUS_HINTS` / `CONCLUSION_HINTS`
  dictionaries plus `explainStatus()` helper — verbose lines read
  `[in_progress] (currently executing)` instead of bare `in_progress`.
- **Multi-line user-facing waiting message.** The `⏳ Waiting for CI:` line is now
  rendered by `renderBlocker()` — single-line for the common case (one run), but each
  detail on its own indented line when there are multiple.
- 8 new tests added to `tests/test-misleading-merge-logs-1712.mjs` (Groups 5–8); 21
  total. #1480 (31/31) and #1466 (14/14) regression suites still pass.
