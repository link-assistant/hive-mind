---
'@link-assistant/hive-mind': patch
---

Work inside git submodules is no longer lost or published as commits no remote has, and critical-error preservation is faster and better named (#3433, #3572, #3656):

- Every check for unsaved work (the restart and pre-session checks, session-change measurement and the uncommitted-changes feedback) now looks inside submodules, nested ones included. Each submodule with uncommitted files or with commits on no remote is listed as `## <path>: N uncommitted file(s), M commit(s) on no remote`, and the feedback says how to commit inside it.
- Critical-error preservation commits each dirty submodule first, innermost first, on `recovery/<branch>` and pushes it to that submodule's `origin` (or to a GitHub fork). Only then does it record the submodule pointer in the parent. If a submodule's commit reached no remote, the parent keeps its old pointer and the log and comment say so with `❌`.
- The kill/interrupt auto-commit of every tool does the same: it commits and pushes inside the submodules before the parent commits the pointer.
- Before a pull request is marked ready, every submodule pointer it changes must be fetchable from the URL in `.gitmodules`. Commits that are not are pushed under the PR branch name, or in fork mode to a fork with a pull request in the submodule repository, which is linked from the parent PR description. Anything still unreachable keeps the PR a draft, with a comment listing the pointers.
- The recovery branch is never `recovery/detached-head` (#3572). It is named after the PR branch solve already knows, even when the failure happens before that branch is checked out (the limit-reset resume of PR #3531). Without a known branch the checked-out one is used, and otherwise a unique `recovery/detached-<sha8>-<UTC time>`. The recovery branch is now pushed in all of these cases.
- Critical-error preservation starts its private index from a copy of the real one instead of `git read-tree HEAD` (#3656). `git add -u` then hashes only the changed files rather than every tracked file, which took 40 s on a loaded container, and staged-only new files are preserved too. When every uncommitted path is AI tool state (`.claude/worktrees/`, `.formal-ai/` …), the step is skipped before any index work.
