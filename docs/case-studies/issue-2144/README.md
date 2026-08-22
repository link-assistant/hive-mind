# Case study — issue #2144: a closed issue stopped the mergeable loop, silently

> **Issue:** [link-assistant/hive-mind#2144](https://github.com/link-assistant/hive-mind/issues/2144) —
> _Closed issues should not block preparation to merge, and handled correctly in all other cases_
> **Pull request:** [link-assistant/hive-mind#2145](https://github.com/link-assistant/hive-mind/pull/2145)
> **Incident:** `solve https://github.com/link-assistant/formal-ai/pull/927 --auto-merge …`, execution
> `8cf80dad-8d86-410d-913e-c9f031b9c069`, 2026-08-06 06:46:59 → 07:48:09 UTC, hive-mind **v2.11.12**

An `--auto-merge` run on an open, mergeable, CI-clean pull request stopped after
its first monitoring iteration because the _issue_ the pull request closes had
already been closed. It printed `❌ GITHUB TARGET UNAVAILABLE`, posted nothing to
GitHub, and exited `0` — so from the outside the run looked successful while the
pull request sat unmerged. A human merged it manually two hours later
(`merged_at: 2026-08-06T09:51:10Z`, see `data/github/formal-ai-pull-927.json`).

---

## Stored data

| Path                                             | What it is                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/runs/original-run.log.txt`                 | The complete 11 518-line attached log of the failing run, as published in [the gist referenced by the issue](https://gist.githubusercontent.com/konard/38d41810419be0e0c4bb14699b849727/raw/a47f6faebf3254c7af8cf365c3dc6c233fee270d/tmp-start-command-logs-isolation-docker-8cf80dad-8d86-410d-913e-c9f031b9c069.log.txt) |
| `data/github/formal-ai-pull-927.json`            | `gh api repos/link-assistant/formal-ai/pulls/927` — the watched pull request                                                                                                                                                                                                                                               |
| `data/github/formal-ai-issue-905.json`           | `gh api repos/link-assistant/formal-ai/issues/905` — the linked issue that was closed                                                                                                                                                                                                                                      |
| `data/github/hive-mind-issue-2144.json`          | `gh api repos/link-assistant/hive-mind/issues/2144` — the requirements source                                                                                                                                                                                                                                              |
| `data/github/hive-mind-issue-2144-comments.json` | Comments on issue #2144 (empty at the time of writing — the requirements are all in the body)                                                                                                                                                                                                                              |

Reproduction: `experiments/issue-2144/repro-closed-issue-stops-loop.mjs`.
Regression tests: `tests/test-closed-issue-merge-blocking-2144.mjs`,
`tests/test-github-terminal-state-1931.mjs`, `tests/test-issue-2130-log-noise.mjs`.

---

## Timeline

All line numbers refer to `data/runs/original-run.log.txt`.

| Time (UTC)          | Line        | Event                                                                                                                                                                                                                                                                                                       |
| ------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-02 20:14:22 | —           | `formal-ai#905` opened (`data/github/formal-ai-issue-905.json`)                                                                                                                                                                                                                                             |
| 2026-08-04 03:59:39 | —           | `formal-ai#927` opened from branch `issue-905-84e37855d352`                                                                                                                                                                                                                                                 |
| 2026-08-05 00:16:20 | —           | **`formal-ai#905` closed** as `completed` — while the pull request was still open                                                                                                                                                                                                                           |
| 2026-08-06 06:46:59 | 1-8         | Run starts: `solve …/pull/927 --auto-merge --tool claude --attach-logs --verbose …`                                                                                                                                                                                                                         |
| 2026-08-06 06:47:…  | 90          | `🚀 solve v2.11.12`                                                                                                                                                                                                                                                                                         |
| …                   | …           | Claude session runs to completion; solution draft log attached to the pull request                                                                                                                                                                                                                          |
| 2026-08-06 ~07:45   | 11385-11405 | `🔄 Auto-merge mode enabled`; `startWatchMode` reports _"Watch mode not enabled - exiting startWatchMode"_; merge permissions confirmed (`push=true, admin=true`)                                                                                                                                           |
| 2026-08-06 ~07:45   | 11406-11417 | `🔄 AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE`, 120 s initial cooldown, then _"Cooldown complete: Starting monitoring loop"_                                                                                                                                                                                 |
| 2026-08-06 ~07:47   | 11419-11420 | First iteration probes GitHub. The **entire** repository, pull request and issue JSON payloads are mirrored into the attached log. The pull request is `"state":"open"`, `"mergeable":true`, `"mergeable_state":"clean"`, 13 commits; the issue is `"state":"closed"`, `"closed_at":"2026-08-05T00:16:20Z"` |
| 2026-08-06 ~07:47   | 11421-11422 | `❌ GITHUB TARGET UNAVAILABLE: Issue #905 has been closed.` / `Action: Stopping auto-restart-until-mergeable mode`. **No GitHub comment is posted.**                                                                                                                                                        |
| 2026-08-06 07:48:03 | 11490       | `🏁 Ending work session`                                                                                                                                                                                                                                                                                    |
| 2026-08-06 07:48:03 | 11504       | `📈 Resource usage (solve exit 0)` — the process exits **successfully**                                                                                                                                                                                                                                     |
| 2026-08-06 07:48:09 | 11518       | `Exit Code: 0`                                                                                                                                                                                                                                                                                              |
| 2026-08-06 09:51:10 | —           | A human merges `formal-ai#927` manually                                                                                                                                                                                                                                                                     |

The decisive fact is on lines 11419-11421 side by side: the pull request was
`mergeable: true, mergeable_state: "clean"` in the _same_ probe that decided the
target was "unavailable".

---

## Requirement inventory

| #   | Requirement (from the issue)                                                                                                                                             | Status                                                                                                                                                                                                                    | Where                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| R1  | With `--auto-merge` or wait-until-mergeable on a pull request with a closed issue, **keep making the pull request mergeable**                                            | ✅                                                                                                                                                                                                                        | `src/github-terminal-state.lib.mjs` demotes issue states to `mergeBlockers`; `watchUntilMergeable` keeps looping |
| R2  | A closed issue is **not** a stopper condition                                                                                                                            | ✅                                                                                                                                                                                                                        | `checkGitHubTerminalState` returns `terminal: false` for `issue_closed` / `issue_unavailable`                    |
| R3  | The **only** stopper is merging/closing of the pull request                                                                                                              | ✅                                                                                                                                                                                                                        | Terminal reasons are now pull-request- or repository-scoped only (see the table below)                           |
| R4  | Whenever the process stops, **comment what stopped it and exactly why** — today there is no comment at all                                                               | ✅                                                                                                                                                                                                                        | New `src/automation-stop-reporting.lib.mjs`; 11 call sites across auto-merge, watch and the merge attempt        |
| R5  | A closed issue may block **auto-merge only**, never auto-restart/resume-until-mergeable                                                                                  | ✅                                                                                                                                                                                                                        | `attemptAutoMerge` gates the merge call on `issueMergeBlockers`; the loop itself ignores them                    |
| R6  | In that case, **ask the user to reopen the issue** for auto-merge to work, or to merge manually                                                                          | ✅                                                                                                                                                                                                                        | `buildAutoMergeBlockedComment` — verified verbatim by the reproduction script                                    |
| R7  | Double-check all possible edge cases                                                                                                                                     | ✅                                                                                                                                                                                                                        | Edge-case table below; 19 assertions in `tests/test-closed-issue-merge-blocking-2144.mjs`                        |
| R8  | Download all logs/data into `docs/case-studies/issue-2144/` and do a deep case-study analysis (timeline, requirements, root causes, solution plans, existing components) | ✅                                                                                                                                                                                                                        | This document + `data/`                                                                                          |
| R9  | If data is insufficient for a root cause, add debug output / verbose mode                                                                                                | n/a — the attached log was sufficient; it named the exact branch (`❌ GITHUB TARGET UNAVAILABLE`) that only `checkGitHubTerminalState` can produce. A second, unrelated defect _was_ found in the same log (D3) and fixed |
| R10 | If another repository is at fault, file issues there with reproductions, workarounds and fix suggestions                                                                 | n/a — every defect is in hive-mind itself. `gh`, `command-stream` and GitHub's API all behaved correctly; the misclassification was ours                                                                                  |
| R11 | Apply the requirement to the **entire** codebase — fix it everywhere it occurs                                                                                           | ✅                                                                                                                                                                                                                        | Sweep results below                                                                                              |

---

## Root causes

### D1 — issue-scoped states were classified as terminal (the reported defect)

`src/github-terminal-state.lib.mjs` was introduced for
[#1931](https://github.com/link-assistant/hive-mind/issues/1931), where the
problem was the opposite one: a _deleted repository_ made the watcher sleep
forever. The helper therefore treated every 404/410/"Could not resolve" answer —
and a closed linked issue — as terminal, and every caller stopped its loop on
`terminal: true`.

That is correct for the repository, the pull request and the two branches: none
of them can become mergeable again. It is wrong for the linked issue. Closing an
issue is the _normal_ end state of a solved issue; it says nothing about whether
the pull request can be merged. In this incident the issue was closed manually
while the work continued, and the tool concluded its target had disappeared.

**Fix.** The helper now separates two answers:

- `terminal: true` — the loop must stop (repository, pull request, branches).
- `mergeBlockers: [{reason, message, details, resolution}]` — the loop continues,
  but auto-merge is held back and the user is told what to do.

Issue states produce merge blockers only:

| Reason                      | Terminal?              | Scope                                                                       |
| --------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `repository_unavailable`    | yes                    | repository                                                                  |
| `pull_request_unavailable`  | yes                    | pull request                                                                |
| `pull_request_closed`       | yes                    | pull request                                                                |
| `pull_request_merged`       | yes (success)          | pull request                                                                |
| `source_branch_unavailable` | yes                    | pull request (also covers a deleted head _repository_, i.e. a deleted fork) |
| `target_branch_unavailable` | yes                    | pull request (also covers a deleted base repository)                        |
| `issue_closed`              | **no** — merge blocker | issue                                                                       |
| `issue_unavailable`         | **no** — merge blocker | issue                                                                       |

This satisfies R3 literally: after the change, the only stop conditions are the
pull request being merged/closed/unreachable, or the repository/branches it
needs being gone.

### D2 — every stop path was silent

The issue says _"in any case when our process is stopped … we should comment that
we stopped and exactly why. At the moment there is no GitHub comments in that
cases."_ That was accurate for **all** stop paths, not just this one: the log
ends at line 11422 with a console-only message and `exit 0`.

**Fix.** `src/automation-stop-reporting.lib.mjs` is a small, reusable reporter:

- `STOP_REASONS` — a registry of 13 reason codes, each with a human title, an
  explanation of what it means, and concrete next steps.
- `describeStopReason(reason)` — never throws on an unknown code; it degrades to
  a generic description so a new reason can never regress to silence.
- `canComment` — `false` only where commenting is impossible by definition
  (`repository_unavailable`, `pull_request_unavailable`); everything else gets a
  comment.
- `buildAutomationStopComment({reason, mode, message, details})` — the stop
  comment, tagged with the mode (`--auto-merge`, `--auto-restart-until-mergeable`,
  `--watch`) and the machine-readable reason code.
- `buildAutoMergeBlockedComment({blockers, issueNumber})` — the R6 comment.
- `reportAutomationStop(…)` — dedupes against existing tool comments via the
  existing `checkForExistingComment`, posts through the existing
  `postTrackedComment`, and **never throws**: a reporting failure must not turn a
  clean stop into a crash.

It is wired into all 11 stop paths: 4 in `src/solve.auto-merge-attempt.lib.mjs`,
5 in `src/solve.auto-merge.lib.mjs` (`watchUntilMergeable`), 2 in
`src/solve.watch.lib.mjs`.

### D3 — the quiet-probe protection from #2130 was defeated (found in the same log)

Lines 11419-11420 mirror ~33 KB of pull request JSON and the full issue JSON into
the attached log, once per monitoring iteration.
[#2130](https://github.com/link-assistant/hive-mind/issues/2130) had already
fixed this class of noise by making the helper's _default_ command runner quiet
(`wrapDollarWithGhRetry(rawDollar(QUIET_PROBE))`, shipped in v2.11.6 and present
in v2.11.12 — so the fix was in the running binary).

It had no effect here because **all three callers injected their own `$`**:

```js
commandRunner: $,   // ← overrides the quiet default
```

The `--jq '{full_name: …, default_branch: …}'` shape of line 11419 (gojq sorts
keys alphabetically) identifies the emitter as `checkGitHubTerminalState`
precisely.

**Fix.** All three callers now pass `commandRunner: quietProbe($)`, binding the
quiet options to the injected runner. `tests/test-issue-2130-log-noise.mjs`
grew a case that fails if any caller reintroduces a bare `commandRunner: $`.

---

## Edge cases checked

| Case                                                                                   | Behaviour after the fix                                                                                                                            |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue closed, pull request open and mergeable                                          | Loop continues; auto-merge held back with the reopen/merge-manually comment                                                                        |
| Issue deleted or inaccessible (404/410)                                                | Same as above, reason `issue_unavailable`, resolution mentions merging manually                                                                    |
| Issue closed **and** pull request already merged                                       | Terminal `pull_request_merged` (success) — the pull request is checked _before_ the issue, so a merged pull request is never reported as a failure |
| Issue closed and pull request closed                                                   | Terminal `pull_request_closed` with a stop comment                                                                                                 |
| `issueNumber === prNumber` (solve invoked on a pull request URL)                       | The issue probe is skipped entirely — verified by asserting no `/issues/7` call                                                                    |
| Issue closed, but the run is _not_ auto-merge (`--auto-restart-until-mergeable` alone) | Blockers are logged once; the loop is unaffected and never comments about the issue                                                                |
| Repository deleted                                                                     | Terminal `repository_unavailable`, `canComment: false` — no attempt to comment into a repository that is gone                                      |
| Pull request deleted                                                                   | Terminal `pull_request_unavailable`, `canComment: false`                                                                                           |
| Source/target branch deleted                                                           | Terminal, with a stop comment on the pull request                                                                                                  |
| Unknown/new stop reason                                                                | Generic description, `canComment: true` — silence is not the default                                                                               |
| Same stop repeated across iterations                                                   | `checkForExistingComment` dedupes; `reportAutomationStop` returns `{skipped: 'duplicate'}`                                                         |
| `$` throws while commenting (offline, revoked token)                                   | Caught; returns `{posted: false, error}`; the stop still happens                                                                                   |
| No target number available                                                             | `{posted: false, skipped: 'missing_target'}`                                                                                                       |

---

## Codebase sweep (R11)

| Site                                                                                     | Verdict                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/solve.auto-merge.lib.mjs` (`watchUntilMergeable`, `startAutoRestartUntilMergeable`) | Fixed — blockers do not stop the loop; all stops comment                                                                                                             |
| `src/solve.auto-merge-attempt.lib.mjs` (`attemptAutoMerge`)                              | Fixed — the only place where a closed issue blocks anything                                                                                                          |
| `src/solve.watch.lib.mjs` (`startWatchMode`)                                             | Fixed — issue blockers are logged, not stopped on; terminal stops and API-retry exhaustion comment                                                                   |
| `src/github-merge.lib.mjs`, `src/github-merge-ci-wait.lib.mjs`                           | No change — strictly pull-request scoped, they never look at the linked issue                                                                                        |
| `src/telegram-merge-queue.lib.mjs`                                                       | No change — same, pull-request scoped                                                                                                                                |
| `src/github-issue-auto-close.lib.mjs`, `src/github-merge-issue-close.lib.mjs`            | No change — they _close_ issues after a merge; a closed issue there is the goal, not a blocker                                                                       |
| `src/hive.recheck.lib.mjs:37` (via `src/hive.mjs:734`)                                   | No change, deliberately: this skips closed issues when selecting **new work to start**, which is correct. It does not touch pull requests that are already in flight |

---

## Existing components considered

- **GitHub's native auto-merge** (`gh pr merge --auto`) queues a merge until
  checks pass, but it cannot express "ready, but held back because the linked
  issue is closed", and it gives the user no explanation. It also requires the
  feature to be enabled on the repository. Rejected as a replacement; the tool
  keeps its own loop.
- **`checkForExistingComment` / `postTrackedComment` / `TOOL_GENERATED_COMMENT_MARKERS`**
  (the existing tool-comment registry) — reused rather than reinvented, so the
  two new comment kinds are recognised, deduped and filtered as tool output like
  every other comment hive-mind posts.
- **`src/quiet-probe.lib.mjs`** (from #2130) — reused for D3 instead of adding
  another mirroring switch.
- **`src/github-terminal-state.lib.mjs`** (from #1931) — extended, not replaced.
  Its terminal/non-terminal split was the right abstraction; it just lacked a
  third answer ("keep going, but you cannot merge yet").

---

## Observations recorded but deliberately not changed

- **`solve` exits `0` after a stop.** `src/solve.mjs:1435-1460` ignores
  `autoMergeResult.success === false`, which is why the incident run reported
  `Exit Code: 0`. Changing the exit code would change the contract that `hive`
  and the Docker orchestration rely on to distinguish "the tool crashed" from
  "the tool finished its session". The issue's stated remedy for the invisible
  stop is the GitHub comment, which is now implemented; the exit-code question is
  left for a separate, explicit decision.
- **`src/solve.auto-merge.lib.mjs` is 1433 lines**, over the repository's 1350-line
  warning threshold. `attemptAutoMerge` was extracted into
  `src/solve.auto-merge-attempt.lib.mjs` to keep it under the hard 1500-line
  limit; further splitting is out of scope here.

---

## Fix summary

| File                                              | Change                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/github-terminal-state.lib.mjs`               | Issue states become `mergeBlockers` instead of terminal results; `ok()`/`terminal()`/`mergeBlocker()` factories |
| `src/automation-stop-reporting.lib.mjs`           | **New** — stop-reason registry, comment builders, non-throwing deduped reporter                                 |
| `src/solve.auto-merge-attempt.lib.mjs`            | **New** — `attemptAutoMerge` extracted; gates the merge on issue blockers and reports every stop                |
| `src/solve.auto-merge.lib.mjs`                    | Loop no longer stops on issue states; comments on all 5 stop paths; quiet probes                                |
| `src/solve.watch.lib.mjs`                         | Same for watch mode; quiet probes                                                                               |
| `tests/test-closed-issue-merge-blocking-2144.mjs` | **New** — 19 assertions across classification, comment bodies, reporter behaviour and call-site wiring          |
| `tests/test-github-terminal-state-1931.mjs`       | The closed-issue case is inverted to the new, intended behaviour                                                |
| `tests/test-issue-2130-log-noise.mjs`             | New case: no caller may pass a mirroring `$` to the terminal-state probe                                        |
| `experiments/issue-2144/`                         | Reproduction of the incident state                                                                              |
