# Case study: issue #3656 — `Repository has uncommitted changes after clone` on auto resume after limit reset

Issue: https://github.com/link-assistant/hive-mind/issues/3656
Failure: https://github.com/link-assistant/hive-mind/pull/3531#issuecomment-6289611497
Upstream report: https://github.com/anthropics/claude-code/issues/104008

## What happened

A Claude Code session on PR #3531 started five subagents with
`isolation: "worktree"`. Claude Code put their worktrees inside the clone, at
`.claude/worktrees/agent-<id>/`, and kept them because the subagents had
changed files. Then the weekly usage limit was hit. Hive Mind auto-committed
the uncommitted work with `git add -A`, which recorded the five worktrees as
gitlinks (mode `160000`) and pushed them to the pull request branch.

At 11:00 UTC the next day `--auto-resume-on-limit-reset` restarted `solve` in
the same working directory. The worktree HEADs no longer matched the recorded
gitlinks, so `git status --porcelain` printed ` M .claude/worktrees/agent-…`
five times. `verifyDefaultBranchAndStatus` treated any status output as fatal
and threw `Repository has uncommitted changes after clone`, although nothing
had been cloned. The resume was lost.

## Files

| File                                                                                                                                                                 | What it is                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`failure-comment-6289611497.md`](failure-comment-6289611497.md)                                                                                                     | The failure comment with the full 14 KB resume log                                    |
| [`data/pr-3531-usage-limit-comment-6275529236.md`](data/pr-3531-usage-limit-comment-6275529236.md)                                                                   | The usage-limit comment of the session before it                                      |
| [`data/pr-3531-session-log-excerpts.txt`](data/pr-3531-session-log-excerpts.txt)                                                                                     | Excerpts of that session's 37 MB log: the five worktree subagents and the session end |
| [`data/pr-3531-auto-commit-06df2d0ad0.json`](data/pr-3531-auto-commit-06df2d0ad0.json)                                                                               | The auto-commit that added the five gitlinks                                          |
| [`data/pr-3531-head-gitlinks.json`](data/pr-3531-head-gitlinks.json)                                                                                                 | The gitlinks still on the head of PR #3531                                            |
| [`data/pr-3531.json`](data/pr-3531.json), [`data/pr-3531-comments-timeline.txt`](data/pr-3531-comments-timeline.txt), [`data/issue-3656.json`](data/issue-3656.json) | PR and issue metadata                                                                 |
| [`data/claude-code-2.1.306-worktree-probe.txt`](data/claude-code-2.1.306-worktree-probe.txt)                                                                         | The same behaviour reproduced with the current Claude Code                            |
| [`upstream-claude-code.md`](upstream-claude-code.md)                                                                                                                 | The report filed as anthropics/claude-code#104008                                     |

The full session log is not committed (37 MB). It is at
https://raw.githubusercontent.com/konard/public-logs/main/tmp-hive-mind-log-upload-umED6q/dc4ed8d28257fdc6/sanitized.log.txt.

## Timeline (UTC)

| Time                | Event                                                                                                                                            | Evidence                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| 2026-10-19 18:23:20 | Session on PR #3531 starts (Claude Code 2.1.303)                                                                                                 | session log                   |
| 18:34:18 – 18:35:18 | Five Agent calls with `isolation: "worktree"` create `.claude/worktrees/agent-{a6f6b1ec…, a758fc82…, a7ccb079…, a8535b86…, aa7c6edc…}`           | session log lines 75121–79598 |
| 19:29:21            | `usage_limit_reached` (429), "resets 11am (UTC)", session `d7cb90ca-53a3-482f-895c-b4b050591ef6`                                                 | session log line 386226       |
| 19:29:23            | `git status` shows `?? .claude/` and `?? experiments/run-tests-from.sh`                                                                          | session log                   |
| 19:30:30            | Usage-limit comment on PR #3531                                                                                                                  | comment 6275529236            |
| 19:30:31            | Auto-commit `06df2d0ad0` "Auto-commit: Changes made by Claude during problem-solving session": five gitlinks and `experiments/run-tests-from.sh` | commit data                   |
| 2026-10-20 11:13:56 | Auto-resume: `solve v2.39.2 … --resume d7cb90ca-… --working-directory /tmp/gh-issue-solver-1792434128449`                                        | failure log                   |
| 11:14:36            | "Skipping clone: Using existing repository in working directory"                                                                                 | failure log line 109          |
| 11:14:38            | "📌 Default branch: issue-3530-6f80c2bef5a1" (the PR branch)                                                                                     | failure log line 122          |
| 11:14:39            | ` M .claude/worktrees/…` ×5, "Error: Repository has uncommitted changes after clone"                                                             | failure log lines 123–135     |
| 11:14:40 – 11:15:20 | Critical-error recovery on "recovery/detached-head": 40 s private-index pass over the 10.4 GB directory, ends with "nothing to preserve"         | failure log lines 142–154     |
| 11:15:22            | Failure comment 6289611497                                                                                                                       | PR #3531                      |

## Requirements

| #   | Requirement (issue #3656)                                                                             | Where it is met                                                             |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| R1  | Find the root cause of every error, warning, false positive and false negative in the failure         | [Log inventory](#log-inventory), [Root causes](#root-causes)                |
| R2  | Fix them all                                                                                          | [Fixes](#fixes); tests in `tests/test-claude-worktree-scratch-3656.mjs`     |
| R3  | Download logs and data to `docs/case-studies/issue-3656`                                              | [Files](#files)                                                             |
| R4  | Deep case study: timeline, requirements, root causes, solutions, existing components, online research | this document                                                               |
| R5  | Add debug or verbose output where data was missing                                                    | [Added output](#added-output)                                               |
| R6  | Report issues to other repositories with a reproduction, workaround and suggested fix                 | anthropics/claude-code#104008                                               |
| R7  | Apply the fix everywhere in the codebase                                                              | every `git add -A` and every uncommitted-changes check, see [Fixes](#fixes) |

## Log inventory

Every error, warning and odd line of the failure log, classified.

| Log line                                                                            | Verdict                                                                                           | Root cause    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| `Error: Repository has uncommitted changes after clone`                             | **False positive.** The only changes were Claude Code's worktrees, and nothing was cloned         | (a), (b), (c) |
| `📌 Default branch: issue-3530-6f80c2bef5a1`                                        | **Wrong value.** That is the PR branch; the default branch is `main`                              | (d)           |
| `📈 Resource usage (after repository clone)` and `phase=after_clone`                | **Misleading label.** The clone was skipped                                                       | (c)           |
| `💾 Critical error … preserving uncommitted changes on recovery/detached-head`      | **Wrong label.** HEAD was on `issue-3530-6f80c2bef5a1`, not detached                              | (h)           |
| 40 s between 11:14:40.7 and 11:15:20.9, then "nothing to preserve"                  | **Wasted work.** A private-index pass over 10.4 GB for AI tool state only                         | (f)           |
| `?? .claude/` at the end of the previous session (then committed)                   | **False negative.** It was not ignored, so `git add -A` committed it                              | (a)           |
| `⚠️ SECURITY WARNING: --attach-logs is ENABLED`                                     | Correct, by design                                                                                | —             |
| `⚠️ Global agent configuration is not minimal (issue #2190): 1 finding`             | Correct and auto-repaired (#2190)                                                                 | —             |
| `gh auth setup-git could not write the global gitconfig: … Device or resource busy` | Correct. The bind-mounted `~/.gitconfig` is read-only; the next line shows the per-clone fallback | —             |
| `⏩ Skipping tool connection validation` / `GitHub authentication check`            | Correct. `--skip-tool-connection-check` was passed on resume                                      | —             |
| `[use-m] use('…') joined an in-flight load` (STDERR)                                | Debug output of the module loader, not an error                                                   | —             |
| `Container memory … peak 2.9 GB; … OOM killer so far: 0`                            | Informational; no OOM kill                                                                        | —             |
| `Requested (actual model unknown — session ended before result)`                    | Correct; the session failed before Claude started                                                 | —             |

## Root causes

**(a) `git add -A` commits Claude Code's subagent worktrees.** Hive Mind already
kept AI tool scratch out of commits (issue #2119: `.formal-ai/`,
`.playwright-mcp/`, `data/cache/derivations/` in `.git/info/exclude`), but
`.claude/worktrees/` was not in the list. A worktree is a directory with a
`.git` file, so `git add -A` records it as an embedded repository, a gitlink.
The same `git add -A` sat in every tool's auto-commit: Claude, Codex, Agent,
OpenCode, Gemini, Qwen and agent-commander.

**(b) A tracked path is not ignorable.** `.git/info/exclude` only hides
untracked paths. Once a gitlink is committed, every later move of the worktree
HEAD shows as ` M`, and every later `git add -A` re-records it, even after the
exclude entry is added. The fix also needs `git reset -q HEAD -- <path>`
after `git add -A`.

**(c) The status check treats an existing working directory like a fresh
clone.** `verifyDefaultBranchAndStatus` threw on any status output. Right after
a clone that is correct. With `--working-directory` (as used by `--resume` and
`--auto-resume-on-limit-reset`) the directory holds the previous session's
work, and aborting there loses the resume. The check also never ran the AI tool
scratch filter, and both the error text and the resource label said "after
clone" when nothing was cloned.

**(d) "Default branch" is the checked-out branch.** It came from
`git branch --show-current`, which is the default branch only right after a
clone. In a reused directory it is the PR branch. With
`--auto-merge-default-branch-to-pull-request-branch`, `solve.mjs` then ran
`git merge issue-3530-6f80c2bef5a1` on `issue-3530-6f80c2bef5a1`, a no-op
merge, and the local default branch was as old as the original clone.

**(e) The other uncommitted-changes readers did not filter the worktrees.** The
pre-run feedback (`solve.preparation`), the minimal restart prompt and the
interactive-mode frames would have told the agent to commit them.

**(f) The critical-error recovery re-recorded them.** `git add -u` in the
private index re-stages tracked gitlinks. With only AI tool state in the status
it still ran the full pass (40 s here) before concluding "nothing to preserve".

**(g) Trimmed porcelain output broke scratch detection on the first line.**
Every caller `.trim()`s `git status --porcelain`, which turns
` M .claude/worktrees/agent-a6f6…` into `M .claude/worktrees/agent-a6f6…`.
`isAiToolScratchPath` sliced at column 3 and read `claude/worktrees/…`, so the
first line was never recognized. Found by the regression test.

**(h) The recovery branch was named `recovery/detached-head`.** The error came
from the status check, before `solve.mjs` recorded the branch name in
`cleanupContext`, so `recoveryBranchFor(undefined)` fell back to
`detached-head`.

**Upstream.** Claude Code creates the worktrees inside the work tree and does
not ignore them. Its docs only advise users to add `.claude/worktrees/` to
`.gitignore`. Reproduced with Claude Code 2.1.306
([probe](data/claude-code-2.1.306-worktree-probe.txt)) and reported as
anthropics/claude-code#104008.

## Fixes

| Root cause | Change                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)        | `.claude/worktrees/` added to `AI_TOOL_SCRATCH_ENTRIES` (`src/ai-tool-scratch.lib.mjs`), so it lands in `.git/info/exclude` and every status filter                                                                                                                                                                                                             |
| (a), (b)   | New `stageAllExceptAiToolScratch(tempDir, $)`: `git add -A`, then `git reset -q HEAD -- <path>` for tracked scratch roots. Used by all seven auto-commit paths (`claude.uncommitted-changes`, `codex`, `agent`, `opencode`, `gemini`, `qwen`, `agent-commander`)                                                                                                |
| (b)        | New `reportTrackedAiToolScratch`: after branch checkout `solve` warns when scratch is committed on the branch and prints `git rm -r --cached -- .claude/worktrees`                                                                                                                                                                                              |
| (c)        | `verifyDefaultBranchAndStatus({ existingRepository })`: ensures the exclude entries, filters scratch (verbose log of the raw status), and in an existing working directory warns and keeps the changes instead of throwing. A fresh clone still throws. The resource label says "after repository setup, existing working directory" when the clone was skipped |
| (d)        | `resolveRemoteDefaultBranch` (`origin/HEAD`, then `git ls-remote --symref origin HEAD`). In an existing directory the log shows `Checked-out branch: … (existing working directory)`, the default branch is the remote one, and the local default branch is fast-forwarded                                                                                      |
| (e)        | Scratch filtered in `solve.preparation`, `solve.minimal-restart-prompt` and `bidirectional-interactive`                                                                                                                                                                                                                                                         |
| (f)        | `commitUncommittedChangesOnCriticalError` returns early when only scratch is uncommitted, and resets tracked scratch in the private index after `git add -u`                                                                                                                                                                                                    |
| (g)        | `isAiToolScratchPath` reads the path at column 2 when a trimmed first line lost its leading space                                                                                                                                                                                                                                                               |
| (h)        | With no branch from the caller, the recovery branch is named after `git branch --show-current`; it is still pushed only when the caller named the branch                                                                                                                                                                                                        |

New git calls carry `AbortSignal.timeout` (`hive/require-exec-timeout`); the
lint baseline shrank by one call in each converted auto-commit file.

### Added output

- verbose: the raw status before scratch filtering (`Ignoring AI tool scratch in git status`);
- verbose: "Only AI tool state is uncommitted; nothing to preserve before recovery." with the status lines;
- info: `Checked-out branch: <branch> (existing working directory)`;
- warning: uncommitted changes kept in an existing working directory, with the lines;
- warning: AI tool scratch committed on the branch, with the `git rm` command;
- verbose: a failed fast-forward of the local default branch.

## Cleaning up PR #3531

The five gitlinks are still on `issue-3530-6f80c2bef5a1`
([data](data/pr-3531-head-gitlinks.json)). With this fix the next run on that
branch prints the cleanup command. Run it in a clone of the branch:

```bash
git rm -r --cached -- .claude/worktrees
git commit -m "Remove Claude Code subagent worktrees committed by the auto-commit"
git push
```

This PR does not push to the PR #3531 branch.

## Existing components checked

- `src/ai-tool-scratch.lib.mjs` (issue #2119) already held the scratch list,
  `.git/info/exclude` writer and status filter. The fix extends it instead of
  adding a second list.
- `src/critical-error-commit.lib.mjs` (issues #1834, #2315) already used a
  private index so recovery never touches the PR branch.
- `src/solve.repo-setup.lib.mjs` (issues #1785, #1957) owns the default-branch
  and status check; its empty-repository path is unchanged.
- Git itself: `git add` prints "adding embedded git repository" and records a
  gitlink; ignore rules never apply to tracked paths (gitignore(5): "files
  already tracked by Git are not affected").
- Claude Code docs, https://code.claude.com/docs/en/worktrees: worktrees of
  subagents are created under `.claude/worktrees/` and kept when they have
  changes; the docs advise "Add `.claude/worktrees/` to your `.gitignore`".
  No existing upstream issue covered this; the closest are about worktree
  removal (#102588).

## Alternatives considered

- **Add `.claude/worktrees/` to the target repository's `.gitignore`.** That
  changes a tracked file in every repository Hive Mind works on. The local
  `.git/info/exclude` does the same job without a diff.
- **Run `git add -A ':!.claude/worktrees'` at each call site.** That works
  too (checked with git 2.43), but every call site would repeat the list. One
  helper keeps the seven call sites and the scratch list in sync.
- **Always ignore uncommitted changes on resume.** It would hide real work.
  The fix keeps them and says so, and a fresh clone still fails loudly.

## Reproduce

```bash
bash experiments/issue-3656/reproduce-worktree-gitlinks.sh     # git-only reproduction
node experiments/issue-3656/before-after-resume-check.mjs <src-dir>  # BEFORE: the error; AFTER: resumed, default branch = main
node tests/test-claude-worktree-scratch-3656.mjs                # regression test
```

Output of the before/after check against `main` and this branch:

```
=== BEFORE (HEAD) ===
git status --porcelain: " M .claude/worktrees/agent-a6f6b1eccdeeb44b8\n"
RESULT: Repository has uncommitted changes after clone
  | Default branch: issue-3530-6f80c2bef5a1
  | Error: Repository has uncommitted changes after clone
=== AFTER (fix) ===
git status --porcelain: " M .claude/worktrees/agent-a6f6b1eccdeeb44b8\n"
RESULT: resumed, default branch = main
  | Checked-out branch: issue-3530-6f80c2bef5a1 (existing working directory)
  | Default branch: main
```
