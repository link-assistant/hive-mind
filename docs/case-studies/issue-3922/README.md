# Issue #3922: "Final tool result failed: Exit code 1" for a session that succeeded

On 2026-10-31, `solve` v2.39.7 ran with `--auto-restart-until-mergeable` on the fork pull request [G-Ivan-A/mango_ba_prompts#414](https://github.com/G-Ivan-A/mango_ba_prompts/pull/414) (head `konard:issue-413-e424ca2a7c62`). The maintainer asked it to resolve a merge conflict. Claude resolved the conflict, pushed the merge commit and ended its turn with `subtype: success`. Hive-mind still reported the session as failed:

```
❌ Command failed: Final tool result failed: Exit code 1
2026-10-31T17:45:23Z konard: ## 🤖 Solution Draft Log … (three PR comments flattened into one line)
```

The restart loop then stopped with a `tool_failure` report ([comment 6547033337](raw/comment-6547033337.md)). The same headline also went into the failure log comment ([comment 6547033054](raw/comment-6547033054.md)).

This case study covers that false negative and every other error, warning or misleading line found in the [full sanitized log](raw/solution-draft-log.txt) (15,858 lines).

## Data collected

| File                                                                                                                               | What it is                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [raw/solution-draft-log.txt](raw/solution-draft-log.txt)                                                                           | The sanitized log uploaded to the [gist](https://gist.githubusercontent.com/konard/5522d70acb2dad8242058919793893a3/raw/1761a8a892dd5fe10cf3b216d94742eab654c503/tmp-hive-mind-log-upload-mNqFwC-sanitized.log.txt) |
| [raw/comment-6547033054.md](raw/comment-6547033054.md), [raw/comment-6547033337.md](raw/comment-6547033337.md)                     | The two PR comments linked from the issue                                                                                                                                                                           |
| [data/issue-3922.json](data/issue-3922.json)                                                                                       | The issue text. There were no issue comments.                                                                                                                                                                       |
| [data/pr-414.json](data/pr-414.json), [data/pr-414-timeline.json](data/pr-414-timeline.json)                                       | PR #414 metadata and timeline. It is cross-repository and was merged at 18:04:39Z.                                                                                                                                  |
| [data/workflow-ref-probe.txt](data/workflow-ref-probe.txt)                                                                         | The contents API answer for the fork branch name compared with the head SHA                                                                                                                                         |
| [../../../tests/fixtures/issue-3922-gh-pr-checks-no-checks.jsonl](../../../tests/fixtures/issue-3922-gh-pr-checks-no-checks.jsonl) | The four real main-thread stream events of the failing session, extracted by `experiments/issue-3922-extract-fixture.mjs`                                                                                           |

## Timeline (UTC, 2026-10-31)

| Time        | Event                                                                                                                                                                                                                 | Log line     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 17:38:17    | `solve` v2.39.7 starts on PR #414 in continue mode, with `--auto-restart-until-mergeable`.                                                                                                                            | 1            |
| 17:45:08    | The first Claude session finishes successfully. The PR is marked ready and the log is attached.                                                                                                                       | ~13860       |
| 17:45:23    | The log says "🔄 Auto-merge mode enabled - will attempt to merge after verification". One second later it says "Mode: Auto-restart-until-mergeable (will NOT auto-merge)". **(problem 4)**                            | 13882, 13909 |
| 17:47–17:51 | Merge checks run. Each reads `.github/workflows?ref=issue-413-e424ca2a7c62` from the upstream repo and gets HTTP 404. The error is swallowed and the log prints "workflows have PR/push triggers ()". **(problem 3)** | 13934–13936  |
| 17:51:15    | G-Ivan-A comments "решить конфликт" ("resolve the conflict").                                                                                                                                                         | —            |
| 17:52:01    | The loop starts restart 1/5 and converts the PR to draft.                                                                                                                                                             | 14088        |
| 17:52:2x    | Claude merges `main`, resolves the conflict and pushes merge commit `7819203e…`.                                                                                                                                      | —            |
| 17:52:23    | The last tool call is `gh api …/comments …; git log -1 --format=%cI; gh pr checks 414 --repo G-Ivan-A/mango_ba_prompts`.                                                                                              | 15389        |
| 17:52:25    | The tool result is `Exit code 1`: the three comments, the date, then `no checks reported on the 'issue-413-e424ca2a7c62' branch`.                                                                                     | 15443        |
| 17:52:28    | The `result` event is `subtype: success, is_error: false`. Hive-mind vetoes it: "❌ Command failed: Final tool result failed: Exit code 1 …" **(problems 1 and 2)**                                                   | 15783        |
| 17:52:31    | The log shows `[STDOUT] 781…75a`. Every `/commit/7819203e…` link in the uploaded log is masked. **(problem 5)**                                                                                                       | 15844, 13963 |
| 17:52:31    | Auto-restart stops with `tool_failure` and posts the stop report.                                                                                                                                                     | 15849–15851  |
| 17:52:42    | The PR is marked ready again.                                                                                                                                                                                         | timeline     |
| 18:04:39    | The maintainer merges PR #414 by hand.                                                                                                                                                                                | timeline     |

## Requirements from the issue and how each is met

| #   | Requirement                                                                                      | Where it is addressed                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Find the root cause of every error, warning, false positive and false negative, and fix them all | Problems 1–5 below, each with a fix and a regression test                                                                                                                                      |
| R2  | This rare case must not happen again                                                             | Fix 1 classifies the gh status answer. The fixture replay test runs the real events through `executeClaudeCommand`.                                                                            |
| R3  | Error messages must be clear and explanatory, not raw flattened content                          | Fix 2: the headline names the command, its exit code and the decisive output line. Full output goes to the log, indented. The `tool_failure` stop report explains why the loop does not retry. |
| R4  | Collect logs and data in `docs/case-studies/issue-3922` and write a deep case study              | This document, `raw/`, `data/` and the fixture                                                                                                                                                 |
| R5  | Timeline, requirements, root causes, solution plans, existing components, online research        | Sections of this document                                                                                                                                                                      |
| R6  | Add debug or verbose output where the data is not enough                                         | Failure and benign-veto logs now include the tool_use id, the full command and the full output. Workflow lookup failures carry their reason.                                                   |
| R7  | Report upstream issues with repro, workaround and fix suggestion                                 | Filed [cli/cli#14882](https://github.com/cli/cli/issues/14882) with a live repro, workarounds and a code-level fix suggestion. See [Upstream](#upstream-reports).                              |
| R8  | Apply fixes across the whole codebase                                                            | Searched every tool integration (see [Scope check](#scope-check-across-the-codebase))                                                                                                          |
| R9  | Do everything in one PR                                                                          | PR #3923                                                                                                                                                                                       |

## Root causes and fixes

### 1. A status answer from `gh pr checks` vetoed a successful session (false negative)

Since #2263, `executeClaudeCommand` overrides a `success` result when the last main-thread `tool_result` has `is_error: true`. This catches the case where Claude claims success right after a failed verification. #2160 and #2313 added a list of benign cases that do not override success, such as `nothing to commit` and a `git diff --quiet` with nothing to diff.

`gh pr checks` is a status query that uses exit codes as answers:

- In [`pkg/cmd/pr/checks/checks.go`](https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/checks/checks.go), a PR without any check runs returns `fmt.Errorf("no checks reported on the '%s' branch", …)`, so gh exits **1**.
- Pending checks make it exit **8** (`gh pr checks --help`).

PR #414 really had no checks. Its workflows only trigger for `pull_request` on `main`, and the repository has run no Actions workflow since 2026-08-22 (`actions/runs` lists nothing newer; `actions/permissions` returns 403 to us, so the reason can't be seen). Claude ran the command only to look at the state, read the answer correctly and finished. The classifier did not know this answer, so the session was marked failed and the restart loop stopped.

**Fix** (`src/claude.stream-events.lib.mjs`): `classifyToolResultError` now treats two cases as benign.

- **`no_checks_reported`**: exit code 1 and the last non-empty output line is exactly `no checks reported on the '<branch>' branch`. Only the last line counts, so a later real error (for example `error: failed to push some refs`) still fails the session. Other exit codes don't qualify either.
- **`checks_pending`**: exit code 8 together with a `<name>\tpending\t` row from gh's table output. A bare `make: *** Error 8` is not benign.

When a benign last tool result keeps a successful session alive, `claude.lib.mjs` now logs why, with the full command:

```
ℹ️ The last tool call (`…; gh pr checks 414 --repo G-Ivan-A/mango_ba_prompts`) exited non-zero (no_checks_reported: a status answer or a failure the AI handled itself, not a failed verification), so the successful session result stands.
```

**Tests:** `tests/final-tool-result-status-answer-3922.test.mjs` replays the real fixture through `executeClaudeCommand`. On the old code it fails with `failed=true, benign=false`; with the fix the session succeeds.

### 2. The failure message was raw, flattened tool output

The headline was `Final tool result failed: ${error}` with all whitespace collapsed. Three PR comments, including markdown headings and cost tables, became one line in the PR comment and in the stop report. The message did not say which command failed, nor why.

**Fix:**

- The stream-event facts now keep the main thread's `tool_use` id, name and command. Subagent calls are excluded, and the map is bounded to 64 entries.
- `describeFinalToolResultFailure` builds the message, for example:

  ```
  Claude reported success, but its last command `javac Main.java` exited with code 1: Main.java:3: error: not a statement
  ```

  - The command is clipped to 160 characters.
  - The reason is the last line that looks like an error, ignoring summary lines like `1 error`, clipped to 240 characters. Otherwise it is the last line.

- The full output is logged once, indented, under the tool_use id.
- `automation-stop-reporting.lib.mjs` now explains the `tool_failure` stop: the loop restarts for PR feedback, CI and merge state, not to repeat a failed session. A next step says what to do when the error came from a status command.

**Tests:** `tests/final-tool-result-status-answer-3922.test.mjs` covers the javac case, the message variants and the id mapping. `tests/claude-result-error-precedence-2687.test.mjs` was updated to the new wording.

### 3. The workflow trigger check read a fork branch from the upstream repository

`getMergeBlockers` called `checkWorkflowsHavePRTriggers(owner, repo, verbose, prBranchRef)`, which reads `repos/G-Ivan-A/mango_ba_prompts/contents/.github/workflows?ref=issue-413-e424ca2a7c62`. That branch exists only in the fork, so GitHub answers `404 No commit found for the ref` ([probe](data/workflow-ref-probe.txt)).

The function then:

- discarded gh's stderr (`2>/dev/null`);
- logged the error only in verbose mode;
- returned the "assume triggers exist" fallback with an empty list.

The result was `workflows have PR/push triggers ()`: a claim with an empty list as its evidence.

The PR's head SHA does resolve in the upstream repository, because GitHub stores fork PR heads under `refs/pull/<n>/head`.

**Fix:**

- Both call sites pass `ciStatus.sha || prBranchRef`.
- On error the function now returns `lookupFailed`, `lookupError` (gh's own message) and `ref`, and no longer discards stderr.
- `describeWorkflowTriggers` prints either the workflow names, or `workflow files could not be read at <ref>: <reason>; assuming they do`.

**Tests:** `tests/workflow-triggers-fork-ref-3922.test.mjs` uses a fake `gh` on `PATH` that answers like GitHub did.

### 4. The post-session line promised a merge that the mode does not perform

`solve.results.lib.mjs` printed "Auto-merge mode enabled - will attempt to merge after verification" for both `--auto-merge` and `--auto-restart-until-mergeable`. Only `--auto-merge` merges; the monitor's banner prints "will NOT auto-merge" for the other mode.

**Fix:** `describePostSessionMergeWait(argv)` uses the same rule as the monitor (`argv.autoMerge`).

**Tests:** `tests/merge-mode-message-3922.test.mjs`.

### 5. Commit SHAs in the uploaded log were masked as if they were tokens

`captureSessionOutcome` (`src/session-progress.lib.mjs`) ran `git rev-parse HEAD` through command-stream. command-stream mirrors stdout into the log by default, so the log got a bare `[STDOUT] 7819203e…` line.

The sanitizer cannot tell a bare 40-hex line from a classic 40-hex token, so it masked the value. Its second pass then replaced **every** occurrence, including `https://github.com/…/commit/7819203e…` links. The log became `…/commit/781…75a`, which hides exactly the commit the reader needs.

**Fix:**

- The git probes run with `mirror: false`.
- `hexHasCommitEvidence` keeps a 40-hex value when the same content shows it to be a public commit id: after `/commit/`, `/commits/`, `/tree/` or `/blob/`, as a `headRefOid`/`sha`/`oid`/`commit_id`-like JSON value, or right after `git rev-parse`.
- A bare value without such evidence is still masked.

**Tests:** `tests/sha-commit-evidence-3922.test.mjs`. The existing `tests/test-token-sanitization.mjs` and `tests/test-sanitization-stats-1745.mjs` still pass.

### Other lines checked and left as they are

- `⚠️ SECURITY WARNING: --attach-logs is ENABLED` is intended.
- `[STDERR] [use-m] …`, `[model-resolution] …`, `From https://github.com/…` and `Switched to a new branch` are ordinary diagnostics and git progress on stderr.
- `ℹ️ gh exec (…): error is not retryable [transient=no]; propagating to caller.` is the rate-limit wrapper reporting the 404 from problem 3. It is now followed by a message that explains the 404.
- The PR was converted to draft at the restart (14088) and left as draft after the false failure, which is the #2263 design for failed sessions. It was marked ready again at 17:52:42. With fix 1 the session succeeds, so this does not happen in the first place.
- About 146 other `$({ cwd })` call sites also mirror stdout. They are intended progress output, and fix 5's evidence rule protects commit SHAs in them, so they were not changed.

## Scope check across the codebase

- `grep` finds the final-tool-result veto (`updateTerminalToolResult`, `classifyToolResultError`) only in `src/claude.lib.mjs` and `src/claude.stream-events.lib.mjs`.
- The Codex, Agent, OpenCode, Gemini and Qwen integrations do not override a successful result based on the last tool call.
- `checkWorkflowsHavePRTriggers` has exactly the two call sites fixed above.
- `repeated-tool-call-breaker.lib.mjs` already treats `gh pr checks` as polling (#2395).
- The merge-mode wording appeared only in `solve.results.lib.mjs`.

## Online research and existing components

- **gh source:** [`pkg/cmd/pr/checks/checks.go`](https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/checks/checks.go) returns a plain error (exit 1) for "no checks reported". `gh pr checks --help` documents exit code 8 for pending checks.
- **[cli/cli#9390](https://github.com/cli/cli/issues/9390)** (closed 2024-08-16): "pr checks returns failure code if there are no checks". The maintainers reproduced it and asked for (1) a distinct or zero exit code for "no checks" and (2) documented exit codes. [cli/cli#9452](https://github.com/cli/cli/pull/9452) closed it by documenting only exit 8. gh 2.102.0 (2026-09-30) still exits 1 for "no checks", and its help lists only `8: Checks pending`.
- **[cli/cli#9682](https://github.com/cli/cli/issues/9682)** (open): the same problem for `--required` ("no required checks reported").
- **[cli/cli#7401](https://github.com/cli/cli/issues/7401)** (closed): "no checks" races in `--watch`. Any upstream fix has to keep this working.
- **gh already has the mechanism:** `internal/ghcmd/cmd.go` maps `cmdutil.NoResultsError` to exit 0 (and prints the message on a TTY). `gh label list`, `gh workflow list` and others already use it.
- **[electron/electron#49630](https://github.com/electron/electron/pull/49630)**: a downstream project that hit the same exit 1. It switched to `gh pr view --json statusCheckRollup`, which returns `[]` with exit 0. This is the recommended workaround for scripts and prompts.
- **GitHub REST contents API:** `ref` accepts "the name of the commit/branch/tag". Fork branches are not refs of the base repository, but PR head commits are reachable there.
- **Token detection:** GitHub's current tokens carry prefixes (`ghp_`, `gho_`, `ghs_`, `github_pat_`; see [GitHub's token format announcement](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/)). Only legacy 40-hex tokens look like commit SHAs, which is why `token-sanitization.lib.mjs` masks unknown bare 40-hex values at all. Secret scanners such as secretlint (`npm run check:secrets`) rely on prefixes and surrounding context instead of masking every hex string. Fix 5 uses surrounding context in the same way, as positive evidence of a commit id, and still masks unknown hex values.

## Upstream reports

- **gh (cli/cli):** filed [cli/cli#14882](https://github.com/cli/cli/issues/14882) ([copy](raw/upstream-cli-cli-14882.md)).
  - It includes a live reproduction on PR #414 with gh 2.102.0 and the `statusCheckRollup` workaround.
  - It suggests a fix in `populateStatusChecks`: return `cmdutil.NoResultsError`, or a distinct documented exit code if exit 0 is too breaking.
  - #9390 is closed and #9682 covers only `--required`, so this is not a duplicate.
  - Hive-mind does not depend on the upstream fix: fix 1 matches the exact message gh prints today.
- **Claude Code:** it correctly reported `is_error: true` for a non-zero exit and `subtype: success` for the turn. Nothing there needs reporting.
- **command-stream:** mirroring stdout is a documented default that callers can turn off (`mirror: false`), so nothing needs reporting.

## Verification

- New tests:
  - `tests/final-tool-result-status-answer-3922.test.mjs` (7)
  - `tests/sha-commit-evidence-3922.test.mjs` (4)
  - `tests/workflow-triggers-fork-ref-3922.test.mjs` (3)
  - `tests/merge-mode-message-3922.test.mjs` (3)
- Each new test file fails on the code before its fix and passes after it.
- Related suites re-run:
  - final-result handling: #2687, #3015, #2263, #2313, #2160, #2301, #2395;
  - sanitization: `test-token-sanitization`, #1745;
  - session progress: #2247, #2839, #3469, #2313;
  - merge loop: #1503, #1480, #1690, #1345, #1442, #1466, #1363, #2182.
- CI on this pull request found two things that the targeted runs above missed:
  - `tests/extracted-modules-2198.test.mjs` failed because `src/claude.lib.mjs` and `src/token-sanitization.lib.mjs` had grown to 1356 lines, above the 1350-line warning threshold of `scripts/check-file-line-limits.sh`. The final-tool-result log lines moved to `formatFinalToolResultOutput` and `describeBenignFinalToolResult` in `src/claude.stream-events.lib.mjs`, and the `hexHasCommitEvidence` docs were shortened. Both files are now at or under the threshold.
  - [Checks and release run 41231726038](https://github.com/link-assistant/hive-mind/actions/runs/41231726038) failed in `detect-changes` because the dependency freshness gate blocks pull requests on stale pins. Twenty pins had gone stale since `main` last passed, none of them related to this issue. They were refreshed (Formal AI 0.355.27, nektos/act v0.2.93, eslint 10.14.0, lino-objects-codec 0.9.4, and the lockfile via `npm update`), and `node scripts/check-dependency-freshness.mjs` reports every declaration current.
- `tests/test-solution-summary.mjs` is not in the default suite. It fails on `origin/main` too (`checkForAiCreatedComments should be imported`), so it is unrelated to this change and was left alone.
