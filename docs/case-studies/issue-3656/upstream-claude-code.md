# [BUG] Kept subagent worktrees under `.claude/worktrees/` are not git-ignored, so `git add -A` commits them as embedded repositories (gitlinks)

Filed as https://github.com/anthropics/claude-code/issues/104008 (2026-10-21).

## Description

When the Agent tool runs with `isolation: "worktree"`, Claude Code creates a git
worktree at `<repo>/.claude/worktrees/agent-<id>/`. If the subagent changes or
commits anything, the worktree is kept after the subagent finishes. Claude Code
does not add `.claude/worktrees/` to `.git/info/exclude` (or anywhere else), so
the kept worktree shows up as untracked in the parent repository:

```
?? .claude/worktrees/agent-a8f64aabd1c583ac2/
```

Any `git add -A` / `git add .` in the parent repository (by the main agent, a
hook, or a wrapper that auto-commits) then records each worktree as an embedded
git repository, i.e. a gitlink with mode `160000`:

```
warning: adding embedded git repository: .claude/worktrees/agent-a8f64aabd1c583ac2
hint: You've added another git repository inside your current repository.
```

Once committed, the gitlink tracks the worktree's HEAD. When the worktree moves
on (the subagent commits again, or the worktree is pruned), the parent reports
` M .claude/worktrees/agent-<id>` forever, which breaks any "is the working
tree clean?" check. Clones of the branch carry dangling gitlinks that point at
commits that exist only in the local worktree.

The docs (https://code.claude.com/docs/en/worktrees) suggest adding
`.claude/worktrees/` to `.gitignore`, but that is advice to every user of every
repository. Claude Code creates the directory itself and could keep it out of
the index without touching tracked files.

We hit this in production: an automated session ran 5 worktree subagents. At the
usage limit the wrapper committed the uncommitted work with `git add -A`, and
5 gitlinks landed on a pull request branch. The next run refused to resume
because the working tree was "dirty" (see
https://github.com/link-assistant/hive-mind/issues/3656).

## Reproduction

With Claude Code 2.1.306, in any repository whose `.gitignore` does not mention
`.claude/worktrees/`:

1. Ask Claude to run a subagent with `isolation: "worktree"` that commits one
   file in its worktree, so the worktree is kept.
2. In the main checkout:

```
$ git check-ignore -v .claude/worktrees/agent-<id> || echo not-ignored
not-ignored
$ git status --porcelain
?? .claude/worktrees/agent-<id>/
$ git add --dry-run -A
warning: adding embedded git repository: .claude/worktrees/agent-<id>
add '.claude/worktrees/agent-<id>/'
```

Plain git reproduces the effect of the worktree Claude Code creates:

```bash
dir=$(mktemp -d) && cd "$dir" && git init -q -b main repo && cd repo
git config user.email t@t && git config user.name t
echo a > a.txt && git add a.txt && git commit -qm init
git worktree add -q .claude/worktrees/agent-abc -b worktree-agent-abc   # what isolation: "worktree" does
echo work > .claude/worktrees/agent-abc/b.txt
git add -A && git commit -qm "auto-commit"        # warning: adding embedded git repository
git ls-tree HEAD .claude/worktrees/                 # 160000 commit ... .claude/worktrees/agent-abc
(cd .claude/worktrees/agent-abc && git add b.txt && git commit -qm sub)
git status --porcelain                              #  M .claude/worktrees/agent-abc
```

## Expected

The kept worktrees of subagents are invisible to `git status` and `git add -A`
in the main checkout, as Claude Code's own scratch state.

## Workaround

- Add `.claude/worktrees/` to `.git/info/exclude` (local to the clone, no
  tracked-file change) or to `.gitignore`. This hides new worktrees only.
- A gitlink that is already committed is tracked, so ignore rules do not apply
  to it. After `git add -A`, run `git reset -q HEAD -- .claude/worktrees` to
  keep it out of the next commit. Remove it from the branch with
  `git rm -r --cached -- .claude/worktrees` and commit.

## Suggested fix

When Claude Code creates the first worktree under `.claude/worktrees/`, append
`.claude/worktrees/` to `$(git rev-parse --git-common-dir)/info/exclude` if no
ignore rule already covers it. This mirrors how tools keep their own state out
of the user's index without editing tracked files.

An alternative is to create the worktrees outside the work tree (for example
under `$(git rev-parse --git-common-dir)/claude-worktrees/`), where `git add`
never sees them.

## Environment

- Claude Code 2.1.306 (reproduced); the production failure was on 2.1.303
- Linux, git 2.x
- Related: #102588 (worktree removal in submodules), the worktrees docs above
