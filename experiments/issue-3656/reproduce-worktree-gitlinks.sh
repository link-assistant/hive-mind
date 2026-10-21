#!/usr/bin/env bash
# Issue #3656: reproduce how Claude Code subagent worktrees under .claude/worktrees/
# end up committed as gitlinks by `git add -A`, and how they then show up as
# " M" in `git status --porcelain` on the next (resumed) run.
set -u
dir=$(mktemp -d)
cd "$dir"
git init -q -b main repo && cd repo
git config user.email t@t; git config user.name t
echo a > a.txt && git add a.txt && git commit -qm init
# What Claude Code's Agent tool with isolation: "worktree" does
git worktree add -q .claude/worktrees/agent-abc -b worktree-agent-abc
echo work > .claude/worktrees/agent-abc/b.txt
echo "--- status before auto-commit"; git status --porcelain
echo "--- auto-commit (git add -A)"; git add -A 2>&1 | head -3; git commit -qm "Auto-commit"
git ls-tree -r HEAD | grep agent
echo "--- subagent commits in its worktree (HEAD moves)"
(cd .claude/worktrees/agent-abc && git add b.txt && git commit -qm sub)
echo "--- status on resume (the failure)"; git status --porcelain
echo "--- reset on a pathspec that matches nothing"; git reset -q HEAD -- .formal-ai; echo "exit=$?"
echo "--- with .git/info/exclude, a fresh worktree is not staged by git add -A"
git worktree add -q .claude/worktrees/agent-def -b worktree-agent-def
echo ".claude/worktrees/" >> .git/info/exclude
git status --porcelain; git add -A; git diff --cached --name-only
echo "--- tracked gitlink still staged by git add -A; reset puts it back"
git reset -q HEAD -- .claude/worktrees; git diff --cached --name-only; echo "(empty above = nothing staged)"
rm -rf "$dir"
