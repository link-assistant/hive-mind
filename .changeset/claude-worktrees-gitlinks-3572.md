---
'@link-assistant/hive-mind': patch
---

Claude subagent worktrees no longer reach the pull request, and a limit-reset resume no longer stops on them (#3572, #3656):

- `.claude/worktrees/` (created by Claude Code subagents with `isolation: "worktree"`) is AI tool state. It is written to `.git/info/exclude` at clone time and again when a `--working-directory` is reused, so it is never staged or reported as uncommitted.
- Every auto-commit path (claude, codex, agent, opencode, gemini, qwen, agent-commander) unstages any nested repository that `.gitmodules` does not list after `git add -A`, with a log line. A gitlink that an earlier run already pushed keeps its committed entry.
- The clean-tree check of a reused working directory ignores AI tool state. Real leftover work still stops the run, and the error now says "in the reused working directory" instead of "after clone".
- A reused working directory reports `Current branch` (the PR branch) and `Default branch` (from `origin/HEAD`), and the auto-merge merges the real default branch, fast-forwarded first, instead of merging the PR branch into itself.
- A status line whose leading space was trimmed away (` M .claude/…` read as `M .claude/…`) is still recognised as AI tool state.
