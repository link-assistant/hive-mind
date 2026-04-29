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

No upstream issue is needed — the bug was entirely in `link-assistant/hive-mind`. The
external workflow finished successfully (`check-runs-dfc4c14.json` shows `total_count: 22`).
