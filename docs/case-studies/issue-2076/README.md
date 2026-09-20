# Case Study — Issue #2076: Unclear failure when a PR head is requested as its base

- **Issue:** [link-assistant/hive-mind#2076](https://github.com/link-assistant/hive-mind/issues/2076)
- **Pull request:** [#2078](https://github.com/link-assistant/hive-mind/pull/2078)
- **Incident:** 2026-07-17 20:48–20:49 UTC
- **Investigated:** 2026-07-18
- **Affected command:** `solve <issue-url> --base-branch <branch>` while auto-continuing an existing pull request

## Executive summary

The reported session ended with a generic `exit code: 1` notification. Its full
log contained a GitHub GraphQL error about there being no new commits between
two identically named branches, but did not explain the configuration mistake
or the required intervention.

The caller passed `--base-branch issue-4-d90389b4efed`. Auto-continue then found
PR #5 whose head/work branch was also `issue-4-d90389b4efed` and whose actual
base/target was `main`. Hive Mind's base-branch guard queried only the current
base, concluded that the PR had been incorrectly retargeted, and ran:

```text
gh pr edit 5 --base issue-4-d90389b4efed
```

That asks GitHub to make the PR's source branch its destination. GitHub rejects
this impossible range, so the generic wrapper reported a failed work session.

The fix makes the shared guard read both `baseRefName` and `headRefName` before
it mutates a mismatched PR. If the requested base is the PR head, Hive Mind now
stops without changing the PR and explains all three relevant facts: which
branch is the source, which branch is the current target, and how to rerun or
omit `--base-branch`. The central guard is used by initial solve, restart, and
auto-merge flows, so the correction covers every existing enforcement path.

## Reproduction

Given an existing pull request with this range:

```text
baseRefName: main
headRefName: issue-4-d90389b4efed
```

resume its issue with:

```text
solve https://github.com/OWNER/REPOSITORY/issues/4 \
  --base-branch issue-4-d90389b4efed
```

Before the fix, Hive Mind attempted to retarget the PR to its own head and
surfaced GitHub's low-level GraphQL failure. After the fix, the guard makes one
read-only query, performs no `gh pr edit`, and reports:

```text
Invalid --base-branch 'issue-4-d90389b4efed' for PR #5: it is the pull
request's head branch (the source/work branch), so it cannot also be the base
branch (the target branch). The pull request currently targets 'main'. Rerun
with --base-branch main to preserve that target, choose another target branch,
or omit --base-branch to keep the existing pull request target. Manual
intervention is required; no pull request changes were made.
```

The minimal automated reproduction is in
`tests/test-issue-1994-locked-solve-options.mjs`. It also asserts that the
invalid configuration executes no mutation command.

## Timeline

| UTC time   | Event                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| 20:48:09   | Detached Docker execution was created with the conflicting explicit `--base-branch`.          |
| 20:48:52   | Hive Mind 2.8.1 started `solve`; resource and authentication preflights passed.               |
| 20:49:12   | Auto-continue found the prepared `issue-4-d90389b4efed` branch and open PR #5.                |
| 20:49:19   | PR #5 was selected; its merge state was clean and its head branch was recorded.               |
| 20:49:22   | The repository was cloned and the PR head branch was checked out successfully.                |
| 20:49:25   | The guard observed actual base `main` but expected the explicit value `issue-4-d90389b4efed`. |
| 20:49:27   | The guard attempted to retarget PR #5 to its own head; GitHub rejected the update.            |
| 20:49:33   | Sanitized failure logs were attached to the private PR.                                       |
| 20:49:44   | The container exited with code 1 and was retained for investigation.                          |
| 2026-07-18 | The generic external notification and sanitized full log were attached to issue #2076.        |

## Root-cause analysis

### Direct cause

`--base-branch` means the branch **into which** pull-request changes should be
merged. It was given the already prepared branch that **contained** the pull
request changes. Those are opposite sides of a pull request.

### Product defect

The explicit option was invalid in the discovered PR context, but the guard
verified only `baseRefName`. It could identify a mismatch but could not
distinguish these cases:

1. an agent genuinely retargeted the PR away from the requested base; or
2. the requested base was actually the PR's head and could never be restored.

It therefore used a mutation as its first diagnostic step. The resulting error
described GitHub's comparison invariant, not the user's mistake or recovery.

### Why existing defenses did not catch it

- CLI validation checked that the branch name was syntactically valid and that
  the remote branch existed. Both were true.
- The base-lock guard was designed for a previously observed agent retargeting
  bug and correctly restored ordinary mismatches, but lacked the head branch.
- Auto-continue knew the PR head earlier, but the invariant is enforced from
  several workflows. Fixing only that call site would leave restart and
  auto-merge paths inconsistent.
- Failure-log attachment worked, but the relevant log still ended in a
  low-level GraphQL symptom. The outer notification consequently had no concise
  root cause to display.

The unrelated `.gitconfig: Device or resource busy` warning was explicitly
handled as non-fatal. Clone, checkout, and subsequent PR inspection succeeded,
so it was not causal. CPU, memory, disk, authentication, and Docker startup also
completed successfully; the container was not OOM-killed.

## Requirements and traceability

| Requirement                                     | Resolution / evidence                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Preserve all supplied incident data             | The original 64 KB log, authenticated screenshot, gist metadata, issue/PR snapshots, and all comment/review channels are in `raw/`. |
| Reconstruct the sequence of events              | See the timestamped timeline above, derived from `raw/start-command.log`.                                                           |
| Enumerate issue requirements                    | This table maps each explicit request to an artifact or implementation.                                                             |
| Find the actual root cause                      | The full branch range proves the requested base equals the existing PR head.                                                        |
| Provide a descriptive manual-intervention error | The new error names source, target, current base, safe rerun options, and confirms no mutation occurred.                            |
| Apply the fix everywhere                        | The change is in `ensurePullRequestBaseBranch`, shared by solve, restart, and auto-merge callers.                                   |
| Reproduce before fixing                         | The regression test failed on the previous behavior and passes with the guard change.                                               |
| Research existing components/libraries          | GitHub's documented base/head semantics and GitHub CLI's `--base` behavior are reviewed below. No new dependency is needed.         |
| Report an upstream issue if appropriate         | No upstream defect exists: GitHub correctly rejects a PR whose base and head are the same. No external issue was filed.             |

## Solutions considered

### Silently keep the current PR base

Rejected. It would make the session continue, but would ignore an explicit user
request. The caller may have intended a different legitimate target branch.

### Infer the default branch

Rejected. Existing PRs can intentionally target non-default release or stacked
branches. The current PR base is useful recovery guidance, not always the only
correct answer.

### Validate only in auto-continue

Rejected. It would fix this incident but not direct PR resumes, restart loops,
or auto-merge enforcement. The invariant belongs in the shared guard.

### Query the complete PR range and fail before mutation (selected)

This preserves explicit-option semantics, prevents a doomed GitHub write,
provides sufficient diagnostics for manual intervention, and applies uniformly
to every current guard caller. It uses fields already exposed by `gh pr view`,
so no library or new dependency is necessary.

## Data collected

- `raw/start-command.log` — complete sanitized log from the issue's gist
- `raw/gist-metadata.txt` — authenticated gist provenance and original raw URL
- `raw/issue-screenshot.png` — authenticated download of the reported notification
- `raw/issue.json` and `raw/issue-comments.json` — issue snapshot and complete comment endpoint
- `raw/pr.json` — initial PR #2078 state, commits, files, and checks
- `raw/pr-review-comments.json` — complete inline review-comment endpoint
- `raw/pr-conversation-comments.json` — complete PR conversation endpoint
- `raw/pr-reviews.json` — complete review endpoint

The affected source repository is private. This case study deliberately does
not copy additional private issue or PR content beyond the sanitized artifacts
the reporter published with issue #2076.

## External research

GitHub documents the base as the branch where changes should be applied and the
head as the branch containing the proposed changes. It also states that pull
requests can only be opened between different branches. The GitHub CLI manual
defines `gh pr edit --base` as changing the pull request's base branch. These
facts confirm that GitHub's rejection was correct and that early contextual
validation belongs in Hive Mind.

- [GitHub Docs: Creating a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request)
- [GitHub Docs: Changing the base branch](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/changing-the-base-branch-of-a-pull-request)
- [GitHub CLI manual: `gh pr edit`](https://cli.github.com/manual/gh_pr_edit)
