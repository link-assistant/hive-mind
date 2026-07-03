# Case Study - Issue #2009

**Improve fork-divergence and repository-setup failure messages in GitHub comments and logs.**

- **Issue:** [link-assistant/hive-mind#2009](https://github.com/link-assistant/hive-mind/issues/2009)
- **Pull Request:** [link-assistant/hive-mind#2010](https://github.com/link-assistant/hive-mind/pull/2010)
- **Reported by:** @konard, 2026-07-03
- **Labels:** documentation, enhancement

Captured data for this analysis lives in [`./raw-data/`](./raw-data):

| File                   | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `issue-2009.json`      | Issue metadata and extracted issue body requirements                    |
| `issue-comments.json`  | Issue comment snapshot; the issue had no comments at investigation time |
| `pr-2010.json`         | Prepared PR metadata before this implementation updated it              |
| `related-prs.json`     | Merged PRs that shaped the affected fork-sync and notifier code         |
| `external-research.md` | Official Git and GitHub references used for the solution plan           |

## 1. Summary

Issue #2009 reports that solver failure comments and terminal logs were using generic
fork-divergence advice even when the solver could inspect the concrete fork state.
The old wording also repeated a non-actionable line:

```text
Administrator-only CLI details, if any, are printed in the solver terminal log rather than in this GitHub comment.
```

and used vague conditional phrasing:

```text
If this requires elevated Hive Mind access, ...
```

The right behavior is data-driven:

- If the authenticated Hive Mind user is different from the task requester, the
  comment should ask a Hive Mind administrator to handle manual recreation or
  repository repair.
- If the same user requested the task, the comment can provide direct owner/admin
  commands for deleting, recreating, or repairing the fork.
- For fork divergence, the solver should inspect the fork and upstream refs before
  recommending the guarded force-with-lease option.
- If no fork-only commits exist, the comment can recommend rerunning with
  `--allow-fork-divergence-resolution-using-force-push-with-lease`.
- If fork-only commits exist, the comment should list the exact commits that would
  be removed from the fork default branch history.

## 2. Requirements

| ID  | Requirement                                                                                                                           | Solution plan                                                                                                                     | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R1  | Remove the repeated administrator-only boilerplate from GitHub comments and logs.                                                     | Audit comment builders and failure action sections for the exact phrase and remove it from source.                                | Done   |
| R2  | Remove the vague `If this requires elevated Hive Mind access` wording.                                                                | Replace generic conditional wording with actor-aware owner/admin guidance.                                                        | Done   |
| R3  | If the requester is not the authenticated Hive Mind GitHub user, ask a Hive Mind administrator to handle manual recreation or repair. | Resolve the issue/PR author and current `gh api user` login, then build the action section with that actor context.               | Done   |
| R4  | If the requester is the authenticated user, include direct delete/recreate/manual-repair guidance with example commands.              | Generate owner/admin command examples in the fork-divergence action section.                                                      | Done   |
| R5  | Do not say "if the fork can be overwritten safely"; inspect real fork data.                                                           | Fetch `origin/<branch>` and `upstream/<branch>`, count `upstream..origin` and `origin..upstream`, and build a compare URL.        | Done   |
| R6  | If there are no fork-only commits, recommend rerunning with the guarded force-with-lease flag.                                        | Only include `--allow-fork-divergence-resolution-using-force-push-with-lease` in the inspected zero-fork-commit case.             | Done   |
| R7  | If anything may be lost, list exactly what commits would be lost.                                                                     | Log and comment the first 20 fork-only commits with SHA, author, and subject, with a count of additional commits if truncated.    | Done   |
| R8  | Double-check similar `if` statements in comments and logs.                                                                            | Searched source and tests for the stale phrases and updated affected action sections. Historical case-study data was left intact. | Done   |
| R9  | Collect issue data in `docs/case-studies/issue-2009` and perform a deep case-study analysis with online research.                     | Added this case study, raw-data snapshots, and official Git/GitHub references.                                                    | Done   |
| R10 | Plan and execute everything in single PR #2010.                                                                                       | Implemented and verified all changes on branch `issue-2009-41374fad2784`.                                                         | Done   |

## 3. Root Cause

The old fork-divergence failure path had only a terse reason string:

```text
Repository setup halted - fork divergence requires user decision
```

The GitHub pre-exit notifier rebuilt guidance from that reason text. That meant it
could only infer broad categories such as "fork divergence" or "repository setup",
not the specific fork, upstream, branch, actors, compare URL, or fork-only commits.
As a result, comments fell back to generic conditional advice:

- "If the fork's default branch can be overwritten safely..."
- "If the fork has commits you need to preserve..."
- "If this requires elevated Hive Mind access..."

The fork-sync code also did not attach a subsystem-specific action section to
`safeExit`, so even if the fork-sync layer knew more, that context was not available
to the comment builder.

## 4. External Research

Official references checked while designing the fix:

- Git documents that `git push --force-with-lease` overrides the fast-forward
  restriction only when the remote ref still has the expected value; otherwise the
  push fails. This makes it safer than `--force`, but it is still a history rewrite
  and can remove commits from the target branch if those commits are the history
  being intentionally replaced.
- GitHub documents fork syncing through the web UI, `gh repo sync`, and command-line
  fetch/merge flows. It also notes that people need write access to the fork to sync
  it remotely.
- GitHub compare pages can compare committish refs in a repository or its forks,
  which is useful for the human review link in fork-divergence comments.

See [`raw-data/external-research.md`](raw-data/external-research.md) for source URLs.

## 5. Implementation

The solution adds structured fork-divergence inspection helpers in
`src/solve.branch-divergence.lib.mjs`:

- `getForkDefaultBranchDivergenceSnapshot(...)` fetches the fork and upstream default
  branch refs, counts fork-only and upstream-only commits, captures head SHAs, builds
  a compare URL, and records up to 20 fork-only commits.
- `buildForkDivergenceBlockedReason(...)` builds a multiline reason that preserves
  the inspected repository data for logs and comments.
- `buildForkDivergenceFailureActionSection(...)` builds the GitHub action section
  from the snapshot and actor context.

`src/solve.fork-sync.lib.mjs` now resolves the task requester, inspects the branch
state after a non-fast-forward fork sync rejection, logs the concrete state, and
passes the generated action section through `safeExit`.

`src/exit-handler.lib.mjs`, `src/solve.mjs`, and
`src/solve.pre-pr-failure-notifier.lib.mjs` now carry an optional
`failureActionSection` from the subsystem that detected the failure into the log
upload or fallback comment. This prevents a data-rich failure from being collapsed
back into generic reason-string heuristics.

Generic failure builders in `src/github.lib.mjs`,
`src/solve.pre-pr-failure-notifier.lib.mjs`, and
`src/solve.branch-divergence.lib.mjs` were updated to remove the stale boilerplate
and vague elevated-access wording.

## 6. Expected Comments

Safe divergence case, where the fork has zero fork-only commits:

```text
GitHub inspection found 0 commit(s) unique to origin/main.
Rerun with --allow-fork-divergence-resolution-using-force-push-with-lease to let Hive Mind update the fork using git push --force-with-lease origin main.
```

Unsafe divergence case, where fork-only commits exist:

```text
origin/main has 2 commit(s) unique to origin/main; replacing it with upstream/main would remove them from the fork default branch history.

Commits that would be lost
- 1234567890ab Alice Keep local deployment notes
- fedcba098765 Bob Preserve fork-only config

Ask a Hive Mind administrator to handle manual recreation or fix of the repository.
```

## 7. Verification Strategy

The reproducing regression test is
`tests/test-issue-2009-fork-divergence-guidance.mjs`. It covers:

- same-user zero-fork-commit guidance that recommends the guarded flag and includes
  direct manual commands;
- different-user unsafe guidance that lists the exact fork-only commits and asks an
  administrator;
- multiline blocked reasons preserving fork/upstream/branch/commit data;
- pre-exit notification using an explicit action section instead of rebuilding
  generic fork guidance from the reason text.

Related regression tests cover the pre-PR failure notifier, prior fork PR
permission-denied handling, push rejection diagnostics, and auto-recovery messages.
