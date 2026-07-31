# Issue 2125: `/task --ci-cd` created an issue with CI/CD run duplicates

## Summary

Issue [#2125](https://github.com/link-assistant/hive-mind/issues/2125) reports
that `/task --ci-cd https://github.com/link-assistant/agent` produced
[link-assistant/agent#287](https://github.com/link-assistant/agent/issues/287)
whose "Recent CI/CD runs on `main`" table contains **20 rows for only 2
workflows** — the same _JS CI/CD Pipeline_ and _Rust CI/CD Pipeline_ repeated
for many different commits, spanning 2026-04-25 to 2026-07-30.

The table is meant to tell the solver which workflows are currently broken.
Listing every historical run of the same workflow buries that signal: nine of
the twenty rows are stale results for commits that were superseded months ago,
and the "CI/CD runs found: 20 (9 not passing)" summary counted them all.

## Evidence collected

Raw, re-checkable data lives in [`data/`](data):

| File                                                                               | Content                                                                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`data/hive-mind-issue-2125.json`](data/hive-mind-issue-2125.json)                 | The issue as filed (no comments at capture time).                                                                   |
| [`data/agent-issue-287.json`](data/agent-issue-287.json)                           | The generated issue, including the duplicated 20-row table (the "before" output).                                   |
| [`data/agent-latest-commit.json`](data/agent-latest-commit.json)                   | `fd42c4b` — the release commit `0.25.4` on `main`.                                                                  |
| [`data/agent-latest-commit-runs.json`](data/agent-latest-commit-runs.json)         | `{"total_count": 0}` — that commit produced **no** workflow runs, which is what triggers the fallback.              |
| [`data/agent-main-branch-runs.json`](data/agent-main-branch-runs.json)             | The fallback payload: 155 runs exist on `main`, of which only **2 distinct `workflow_id`s** (219620721, 219620722). |
| [`data/agent-languages.json`](data/agent-languages.json)                           | Linguist bytes used to rank the templates.                                                                          |
| [`data/generated-issue-body-after-fix.md`](data/generated-issue-body-after-fix.md) | The body the fixed code generates from exactly the same 20-run payload — 2 rows.                                    |

Facts captured for this analysis are also compiled in
[`investigation-data.json`](investigation-data.json); external sources are
recorded in [`research-sources.json`](research-sources.json).

## Timeline / sequence of events

1. `/fix --ci-cd` was introduced by
   [#1733](https://github.com/link-assistant/hive-mind/issues/1733) /
   [#1929](https://github.com/link-assistant/hive-mind/pull/1929). Its issue body
   lists the CI/CD runs of the latest default-branch commit.
2. A fallback was added for the common case where the latest default-branch
   commit is a release/tag commit with no runs: when
   `actions/runs?head_sha=<sha>` is empty, `/fix` asks for
   `actions/runs?branch=<default>&per_page=20` instead and relabels the section
   "Recent CI/CD runs on `<branch>`".
3. `/task --ci-cd` was added by
   [#2121](https://github.com/link-assistant/hive-mind/issues/2121) /
   [#2122](https://github.com/link-assistant/hive-mind/pull/2122), reusing the
   same collector (`prepareCiCdIssue`) through `src/fix.ci-cd-issue.lib.mjs`.
4. On 2026-07-31 a user ran `/task --ci-cd https://github.com/link-assistant/agent`.
5. `link-assistant/agent`'s latest `main` commit is `fd42c4b` ("0.25.4"), pushed
   by the release job with `[skip ci]`-style semantics — the GitHub API reports
   `total_count: 0` runs for that sha.
6. The fallback ran and returned the 20 most recent runs on `main`. Those 20 runs
   belong to just 2 workflows.
7. `buildRunsSection` rendered one table row per run, so the created issue
   ([agent#287](https://github.com/link-assistant/agent/issues/287)) listed the
   same two workflows 14 and 6 times respectively, and the context block
   reported "CI/CD runs found: 20 (9 not passing)".

## Requirements extracted from the issue

| #   | Requirement                                                                                 | Status                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `/task --ci-cd` (and `/fix --ci-cd`) must not create issues containing duplicate CI/CD runs | Done — one row per workflow, newest run wins                                                                                                                |
| R2  | Download all logs/data related to the issue into this repository                            | Done — [`data/`](data)                                                                                                                                      |
| R3  | Compile it under `./docs/case-studies/issue-2125`                                           | Done — this folder                                                                                                                                          |
| R4  | Deep case-study analysis: timeline, requirements, root causes, solution plans               | Done — this document                                                                                                                                        |
| R5  | Search online for additional facts                                                          | Done — GitHub REST API docs confirm no server-side "latest run per workflow" filter; see [`research-sources.json`](research-sources.json)                   |
| R6  | Check existing components/libraries that solve the same problem                             | Done — see "Prior art"                                                                                                                                      |
| R7  | If data is insufficient for a root cause, add debug output / verbose mode                   | Root cause was reproducible from live data; a verbose line was still added (see "Fix")                                                                      |
| R8  | Report issues to other affected repositories, with reproductions and fix suggestions        | Not applicable — the defect is entirely in this repository's renderer; the GitHub API behaves as documented. See "Upstream"                                 |
| R9  | Apply the fix everywhere the same problem occurs                                            | Done — the collector, the table renderer and the failure counter are shared by `/fix --ci-cd`, `/task --ci-cd` and the Telegram command; see "Blast radius" |

## Root causes

**Root cause 1 (the duplicates): the renderer had no notion of workflow identity.**
`buildRunsSection()` in `src/fix.ci-cd.lib.mjs` mapped the API array 1:1 to table
rows. `GET /repos/{owner}/{repo}/actions/runs` returns one object per _run_, and
the docs offer no parameter to return only the latest run per workflow — the
caller must collapse them. Nothing did.

**Root cause 2 (why the fallback is duplicate-prone at all):** the `head_sha`
query returns at most one run per workflow, so the bug is invisible on the
primary path. The `branch=` fallback is a fundamentally different shape — runs
across many commits — but it was fed into a renderer written for the
single-commit shape, and the fetch did not request the fields
(`workflow_id`, `created_at`, `run_attempt`) needed to tell runs apart.

**Root cause 3 (the miscount):** `summarizeRunFailures()` counted raw runs, so
"9 not passing" mixed months-old failures with the current state of `main`.

## Fix

`src/fix.ci-cd.lib.mjs`:

- `runWorkflowKey(run)` — stable workflow identity: `workflow_id`, falling back
  to `path`, then the display `name`. A run with no identifying field at all is
  never treated as a duplicate.
- `dedupeRunsByWorkflow(runs)` — keeps the most recent run per workflow
  (`created_at`, then `run_attempt`, then `id`), preserving input order.
- `countDuplicateRuns(runs)` — how many rows were collapsed, for logging.
- `buildRunsSection()` deduplicates, and gained `includeCommit` so the
  branch-fallback table shows which commit each surviving run belongs to
  (necessary, because those rows can come from different commits).
- `summarizeRunFailures()` and `buildCiCdIssueBody()` count deduplicated runs, so
  the summary and the table always agree.

`src/fix.ci-cd-issue.lib.mjs`:

- The runs query now selects `id`, `workflow_id`, `path`, `created_at` and
  `run_attempt` in addition to the previous fields.
- The branch fallback fetches `per_page=100` instead of `20`: after collapsing,
  a workflow that last ran further back than 20 runs ago would otherwise vanish
  from the table entirely.
- `prepareCiCdIssue()` deduplicates centrally and returns `fetchedRuns` /
  `duplicateRuns`; when it collapses anything it emits a verbose line
  (`ℹ️ Collapsed N older CI/CD run(s) …`) through the caller's `log`, which
  `src/fix.mjs` prints. That is the debug output required by R7 — if a future
  payload ever collapses more or fewer rows than expected, the number is visible
  without re-running the API calls.

### Before / after on the exact payload from agent#287

Before (excerpt of [agent#287](https://github.com/link-assistant/agent/issues/287)):

```text
| JS CI/CD Pipeline   | completed | failure | run |   ← 2026-07-30
| JS CI/CD Pipeline   | completed | failure | run |   ← 2026-07-27
| JS CI/CD Pipeline   | completed | failure | run |   ← 2026-07-27
… 17 more rows for the same two workflows …
CI/CD runs found: 20 (9 not passing)
```

After (regenerated from the same 20 runs —
[`data/generated-issue-body-after-fix.md`](data/generated-issue-body-after-fix.md)):

```text
| Workflow | Status | Conclusion | Commit | Run |
| --- | --- | --- | --- | --- |
| JS CI/CD Pipeline | completed | failure | `cff4148` | [run](…/30572373896) |
| Rust CI/CD Pipeline | completed | failure | `7af549d` | [run](…/28688932169) |
CI/CD runs found: 2 (2 not passing)
```

## Blast radius (R9)

Every consumer of CI/CD run tables goes through the two files changed here:

- `src/fix.mjs` — `/fix --ci-cd` CLI (`prepareCiCdIssue` + console summary).
- `src/telegram-task-command.lib.mjs` — `/task --ci-cd` in Telegram
  (`createCiCdIssue` → `prepareCiCdIssue`).
- `src/fix.ci-cd.lib.mjs` — `buildCiCdIssueBody`, used by both.

Other `workflow_runs` consumers (`github-merge*.lib.mjs`,
`solve.auto-merge-helpers.lib.mjs`) query runs _for a single head sha or PR_ to
decide merge readiness; they do not render historical tables and must keep
seeing every run (including individual attempts), so they are intentionally
untouched.

## Prior art / existing components considered (R6)

- **GitHub REST API** — no server-side "latest run per workflow" filter exists
  for `GET /repos/{owner}/{repo}/actions/runs`; the parameters are `actor`,
  `branch`, `event`, `status`, `created`, `exclude_pull_requests`,
  `check_suite_id`, `head_sha`, `per_page`, `page`. Collapsing must happen
  client-side.
- **`gh run list`** — the GitHub CLI has the same behaviour: it lists runs, not
  workflows, and offers `--workflow` to filter to one workflow rather than to
  deduplicate. Calling it once per workflow (`gh workflow list` then `gh run
list --workflow <id> --limit 1`) would be N+1 API calls for the same result
  one pass of `dedupeRunsByWorkflow` gives from a single response — rejected.
- **`lodash.uniqBy`** — would express the collapse in one call, but picks the
  _first_ element per key rather than the most recent, and adding a runtime
  dependency for six lines of comparison logic contradicts this repository's
  dependency-light `*.lib.mjs` convention. Rejected.
- **In-repo precedent** — `mapLanguagesToTemplates()` in the same module already
  aggregates by key with an explicit tie-breaker; `dedupeRunsByWorkflow` follows
  that shape deliberately.

## Upstream (R8)

No upstream issue was filed. The behaviour of
`GET /repos/{owner}/{repo}/actions/runs` matches its documentation, and the
duplicates originate solely in this repository's rendering of that payload. The
CI/CD pipeline templates
([js](https://github.com/link-foundation/js-ai-driven-development-pipeline-template),
[rust](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template))
contain no equivalent run-table renderer, so there is nothing to mirror the fix
into. `link-assistant/agent#287` itself remains valid — its CI failures are real;
only the presentation of the run list was noisy.

## Regression tests

`tests/test-fix-ci-cd.mjs` (suite `default`):

- `dedupeRunsByWorkflow keeps the latest run per workflow (issue #2125)` —
  reproduces the agent#287 shape, and covers same-name/different-`workflow_id`
  workflows and re-run attempts.
- `buildRunsSection collapses duplicate workflow runs and can show commits`.
- `summarizeRunFailures counts one run per workflow`.
- `prepareCiCdIssue deduplicates the default-branch fallback runs` — end-to-end
  through a stubbed `gh`: a release commit with zero runs, a branch fallback with
  a duplicate, the verbose collapse line, and the body containing neither the
  stale run link nor an inflated count.
