---
'@link-assistant/hive-mind': patch
---

Keep Claude Code subagent worktrees (`.claude/worktrees/`) out of commits and resumes: every auto-commit stages with `git add -A` and then un-stages tracked AI tool scratch, so moved worktrees are no longer committed as gitlinks; `--working-directory` resumes (`--auto-resume-on-limit-reset`, `--resume`) ignore AI tool scratch, keep the previous session's uncommitted work with a warning instead of failing with `Repository has uncommitted changes after clone`, and take the default branch from `origin/HEAD` instead of the checked-out pull request branch; critical-error recovery skips a status that holds only AI tool state and names the recovery branch after the checked-out branch; and `solve` warns with a `git rm -r --cached` command when such scratch is already committed on the branch (#3656).
