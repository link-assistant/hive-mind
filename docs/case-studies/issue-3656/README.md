# Case study: issue #3656, "`Repository has uncommitted changes after clone` on auto resume after limit reset"

The issue points at [PR #3531 comment 6289611497](https://github.com/link-assistant/hive-mind/pull/3531#issuecomment-6289611497).
That comment is the failure log of the run that should have resumed the session after the Claude usage limit reset.

## Data

| File                                                                                               | What it is                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`data/pr-3531-comment-6275529236-usage-limit.md`](data/pr-3531-comment-6275529236-usage-limit.md) | The "Usage Limit Reached" comment that scheduled the auto resume (reset at 2026-10-20 11:00 UTC, session `d7cb90ca-53a3-482f-895c-b4b050591ef6`)   |
| [`data/pr-3531-comment-6289611497.md`](data/pr-3531-comment-6289611497.md)                         | The failure comment, with the full log of the resume run                                                                                           |
| [`data/ci-run-39311592542-excerpt.txt`](data/ci-run-39311592542-excerpt.txt)                       | The CI failure of [run 39311592542](https://github.com/link-assistant/hive-mind/actions/runs/39311592542), for the commit that pushed the gitlinks |

The full log of the session that hit the limit is in [konard/public-logs](https://raw.githubusercontent.com/konard/public-logs/main/tmp-hive-mind-log-upload-umED6q/dc4ed8d28257fdc6/sanitized.log.txt). It is 37 MB, so it is linked, not copied.

## Timeline (UTC)

| Time                     | Event                                                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-19, before 19:30 | The session used Claude Code subagents with `isolation: "worktree"`. Each one made a git worktree under `.claude/worktrees/agent-<id>/`, inside the repository.                                                                                                                                                |
| 2026-10-19 19:30:31      | The end-of-session auto-commit ran `git add -A`. It created [06df2d0ad](https://github.com/link-assistant/hive-mind/commit/06df2d0ad03183f91d5c73c983c6327c39a785be): `create mode 160000 .claude/worktrees/agent-…` five times, plus `experiments/run-tests-from.sh`. The commit was pushed to the PR branch. |
| 2026-10-19 19:33:38      | CI run 39311592542, job "Release Preflight / Probe publishing credentials" failed at checkout: `fatal: No url found for submodule path '.claude/worktrees/agent-a6f6b1eccdeeb44b8' in .gitmodules`. In the same run, `detect-changes` failed for an unrelated reason: a stale `ignore` lockfile entry.         |
| 2026-10-19 ~19:31        | The usage limit was hit. The auto resume was scheduled for 2026-10-20 11:00 with `--working-directory /tmp/gh-issue-solver-1792434128449`.                                                                                                                                                                     |
| 2026-10-20 11:13:56      | The resume started: solve v2.39.2, `--resume d7cb90ca… --auto-resume-on-limit-reset --auto-resume-iteration 1`.                                                                                                                                                                                                |
| 11:14:24                 | Claude Code was updated from 2.1.303 to 2.1.304. A warning said the global agent config was not minimal (skill `synced`), and it was repaired automatically.                                                                                                                                                   |
| 11:14:36.672             | `Skipping clone` (the working directory was reused).                                                                                                                                                                                                                                                           |
| 11:14:36.906             | `gh auth setup-git` failed with `Device or resource busy`, and solve fell back to the clone-local credential helper.                                                                                                                                                                                           |
| 11:14:38                 | A disk check was logged as `after_clone` / "after repository clone", although no clone ran.                                                                                                                                                                                                                    |
| 11:14:38.122             | `📌 Default branch: issue-3530-6f80c2bef5a1`. This is the PR branch, not the default branch.                                                                                                                                                                                                                   |
| 11:14:39.142             | The `git status --porcelain` output had five ` M .claude/worktrees/agent-*` lines. The worktrees had moved past the commits recorded in 06df2d0ad.                                                                                                                                                             |
| 11:14:39                 | `Repository has uncommitted changes after clone` (solve.repo-setup.lib.mjs:285), so the run stopped.                                                                                                                                                                                                           |
| 11:14:40.562             | `preserving uncommitted changes on recovery/detached-head`                                                                                                                                                                                                                                                     |
| 11:15:20.908             | `Nothing but build output or AI tool state was uncommitted; nothing to preserve.` That took 40 s, and it preserved nothing.                                                                                                                                                                                    |
| 11:15:20.960             | Container memory was 2.7 GB used of a 2.9 GB limit (peak 2.9 GB), with 0 OOM kills. The failure log was attached to the PR.                                                                                                                                                                                    |

## Requirements

Requirements from the issue, and from PR comments 6313800001 and 6272722823:

1. Find the root cause of every error, warning, false positive and false negative in the log, and fix them all.
2. Put the logs and data in `docs/case-studies/issue-3656/`, reconstruct the timeline, list the requirements, find the root causes and propose solutions.
3. If there is not enough data to find a root cause, add debug or verbose output.
4. Report issues in other repositories, with a repro, a workaround and a suggested fix.
5. Apply each fix everywhere the same problem exists (all auto-commit paths, not just Claude's).
6. Recover the PR from the failed auto resume. Remove the pushed gitlinks so CI can check out the branch, and continue the work.

## Root causes

| #   | Problem in the log                                    | Kind                         | Root cause                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Five gitlinks were pushed in 06df2d0ad                | error                        | `git add -A` stages any nested repository as a mode 160000 gitlink, and only prints `warning: adding embedded git repository`. Claude Code subagent worktrees live in `.claude/worktrees/`, inside the working tree. None of the seven auto-commit paths (agent, agent-commander, claude, codex, gemini, opencode, qwen) filtered gitlinks. |
| 2   | CI checkout failed: `No url found for submodule path` | error                        | Same as #1. `actions/checkout` runs `git submodule foreach`, and that fails for a gitlink that `.gitmodules` does not list.                                                                                                                                                                                                                 |
| 3   | `Repository has uncommitted changes` on resume        | false positive               | `.claude/worktrees/` was not in `AI_TOOL_SCRATCH_PATHS` (ai-tool-scratch.lib.mjs), so changes to the worktrees counted as user work.                                                                                                                                                                                                        |
| 4   | The first status line printed as `M .claude/…`        | false negative in the filter | Callers `.trim()` the porcelain output, and this eats the leading space of the first line (` M path` becomes `M path`). `isAiToolScratchPath` then read the path from column 3, got `claude/worktrees/…`, and did not match it as scratch. Even with root cause 3 fixed, the first line would still have been reported.                     |
| 5   | `📌 Default branch: issue-3530-…`                     | wrong label                  | In a reused directory, `git branch --show-current` returns the PR branch. The code labelled it as the default branch, and the later "merge default branch" step then merged the PR branch into itself (a no-op that hid the real default branch).                                                                                           |
| 6   | "uncommitted changes **after clone**"                 | misleading message           | No clone ran (`Skipping clone`). The message did not say that the directory was reused, so the cause looked like a broken clone.                                                                                                                                                                                                            |
| 7   | `recovery/detached-head`                              | wrong name                   | The preservation step ran before the branch was known, so it got the fallback name, not one derived from the PR branch.                                                                                                                                                                                                                     |
| 8   | 40 s to preserve nothing                              | slowness                     | The preservation step builds a temporary index with `git read-tree HEAD`. That index has no stat cache, so the next `git add -u` rehashes every tracked file (about 9,200 files, on a host with load 8 and a cgroup at its memory limit). And it was all AI tool state anyway.                                                              |
| 9   | `after_clone` disk check, "after repository clone"    | wrong label                  | The resource snapshot phase name is fixed, and is also used when the clone is skipped. Informational only.                                                                                                                                                                                                                                  |
| 10  | `gh auth setup-git`: `Device or resource busy`        | warning (expected)           | The global git config is a bind-mounted file in the container, and `gh` writes it by rename, which is not possible across a mount. The clone-local fallback works. This is not a bug in solve.                                                                                                                                              |
| 11  | Container memory 2.7 GB of 2.9 GB                     | warning                      | The task container's memory limit was close. This is tracked by the OOM issues in this PR (#3530, #3125, #2838). There were no OOM kills in this run.                                                                                                                                                                                       |
| 12  | `detect-changes` failed in run 39311592542            | error (unrelated)            | `package-lock.json` had `ignore` 7.0.12, one patch behind the allowed range. This was fixed on `main` and merged in.                                                                                                                                                                                                                        |

## Solutions

Fixed in commit f3cdcbb46 ("Issue #3572, #3656: keep Claude subagent worktrees out of auto-commits and the resume clean-tree check"). The earlier commit b5c553f15 removed the pushed gitlinks from the branch.

- **Root causes 1 and 2:** new module [`src/unregistered-gitlinks.lib.mjs`](../../../src/unregistered-gitlinks.lib.mjs).
  - After `git add -A`, `unstageUnregisteredGitlinks` finds the staged gitlinks (`git ls-files -s -z`, intersected with `git diff --cached --name-only`) that `.gitmodules` does not register.
  - It unstages them with `git reset -q -- <path>`, or `git update-index --force-remove` when there is no HEAD yet, and logs `🧹 Not committing embedded git repository …`.
  - A registered submodule is kept.
  - All seven auto-commit paths call it between `git add -A` and `git commit`.
- **Root cause 3:** `.claude/worktrees/` was added to `AI_TOOL_SCRATCH_PATHS`, so it is git-excluded and filtered from the clean-tree check.
- **Root cause 4:** `isAiToolScratchPath` now finds where the path starts, whether or not the first line was trimmed.
- **Root cause 5:** new `resolveOriginDefaultBranch` (`git symbolic-ref refs/remotes/origin/HEAD`).
  - A reused directory now logs `📌 Current branch:` and `📌 Default branch:` separately.
  - It fast-forwards the local default branch with `git fetch origin <d>:<d>`.
- **Root cause 6:** the error says "in the reused working directory" when the clone was skipped. Lines filtered as AI tool state are logged (`🧹 Ignoring AI tool state: N path(s) left by a previous run`), so the decision can be seen in the log.
- **Root causes 7 and 8:** `src/critical-error-commit.lib.mjs` (#3433 / #3434 group of this PR).
  - The recovery branch is named after the PR branch.
  - The temporary index is seeded from the real index, which keeps the stat cache.
  - The step is skipped when every changed path is AI tool state.
- **Root causes 9 to 12:** need no code change in this issue; see the table above. Root cause 11 is handled by the memory work for #3530, #3125 and #2838.

## Tests

[`tests/issue-3572-claude-worktrees-gitlinks.test.mjs`](../../../tests/issue-3572-claude-worktrees-gitlinks.test.mjs) uses real git repositories and a real `git worktree add`:

- it classifies `.claude/worktrees/` lines, including a trimmed first line;
- it parses `ls-files -s` and `.gitmodules` output;
- the auto-commit commits the real file and no gitlink;
- an unregistered nested repository is unstaged, and a registered submodule is kept;
- a gitlink an earlier run already pushed stays at HEAD when its worktree moves;
- a resume in a reused directory with changed worktrees passes, reports the real default branch and logs what it ignored, while real uncommitted work is still rejected with the "reused working directory" wording;
- a fresh clone keeps the old wording;
- a source check confirms that every auto-commit path unstages gitlinks between `git add -A` and `git commit`.

The debug helper [`experiments/issue-3572-debug-gitlinks.mjs`](../../../experiments/issue-3572-debug-gitlinks.mjs) prints the gitlinks, registered submodules and scratch classification for any directory.

## Existing components checked

- `.gitignore` / `.git/info/exclude`: this is how the existing AI tool scratch paths are kept out (`ensureAiToolScratchIgnored`). It now covers `.claude/worktrees/`. An exclude does not untrack a gitlink that is already committed, which is why b5c553f15 was also needed.
- `git add -A --ignore-submodules`: rejected with `error: unknown option 'ignore-submodules'` (checked with git 2.43). `git add` has no option to skip embedded repositories, so the gitlinks are unstaged after staging.
- `git submodule status`: it fails with `fatal: no submodule mapping found in .gitmodules for path …` for these gitlinks, so it cannot list them. `ls-files -s` mode 160000 is the reliable signal.

## Upstream reports

- anthropics/claude-code: worktree isolation creates nested git worktrees inside the repository, where `git add -A` commits them as gitlinks that break every later checkout. A search found no existing report, only #70456, which is about a lead CWD stranded under `.claude/worktrees/`, and #102588, about `claude -w` in a submodule. The report (link below) suggests creating the worktrees outside the working tree, or writing `.claude/worktrees/` to `.git/info/exclude` when one is created.

## Limits

- The gitlinks that 06df2d0ad pushed are removed from the branch (b5c553f15). The fix stops new ones, but does not rewrite history.
- A user who really wants a nested repository committed must register it in `.gitmodules`. That is the only way the commit would be checkable out anyway.
