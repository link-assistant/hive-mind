# Technical summary

## Code paths involved

- `src/solve.branch.lib.mjs` creates the working branch from `argv.baseBranch || defaultBranch`.
- `src/solve.auto-pr.lib.mjs` creates the draft PR with `--base ${argv.baseBranch || defaultBranch}`.
- Tool-specific prompt builders pass operational instructions to the agent.
- `src/solve.mjs` runs the agent, then result verification, watch mode, and auto-merge.
- `src/solve.auto-merge.lib.mjs` may run more agent iterations before readiness or merge.

## Fix design

### Prompt contract

`src/solve-option-contract.prompts.lib.mjs` builds a shared "Locked solve options" section. When `argv.baseBranch` exists, the prompt states:

- the requested base branch is locked;
- agents must not use `gh pr edit --base` or equivalent UI/API changes;
- agents must not switch the PR to the default branch to avoid conflicts or checks;
- conflicts on the requested base must be fixed against that base or escalated.

When `argv.autoMerge` is true, the prompt states that hive-mind handles auto-merge after verification and agents must not replace it with a manual merge/handoff.

The shared snippet is imported by:

- `src/claude.prompts.lib.mjs`
- `src/codex.prompts.lib.mjs`
- `src/gemini.prompts.lib.mjs`
- `src/opencode.prompts.lib.mjs`
- `src/agent.prompts.lib.mjs`
- `src/qwen.prompts.lib.mjs`

### Runtime guard

`src/solve.pr-base-guard.lib.mjs` adds:

- `getExpectedPullRequestBaseBranch({ argv })`
- `getPullRequestBaseBranch({ owner, repo, prNumber, $ })`
- `ensurePullRequestBaseBranch({ owner, repo, prNumber, argv, log, formatAligned, $ })`

The guard only enforces explicit `argv.baseBranch`. It reads the current PR base with:

```text
gh pr view <pr> --repo <owner>/<repo> --json baseRefName --jq .baseRefName
```

If the current base differs, it restores:

```text
gh pr edit <pr> --repo <owner>/<repo> --base <argv.baseBranch>
```

It then re-reads the base and throws if GitHub still reports a mismatch. This avoids continuing verification or merge readiness work against the wrong target.

### Guard placement

The main solve flow checks immediately after PR availability, after the main agent session before verification, and after watch mode before auto-merge handling. The shared restart executor also runs the guard after every restart iteration, which covers placeholder-description retries, escalation, auto-ensure, keep-working, watch, and auto-restart-until-mergeable sessions. The auto-merge module checks before fork/permission handling so readiness comments and merge decisions use the requested base.

## Test coverage

`tests/test-issue-1994-locked-solve-options.mjs` verifies:

- every prompt builder includes the locked base branch and auto-merge instructions;
- the guard only enforces an explicit `--base-branch`;
- a mocked `master` retarget is repaired back to `create/new-concept`;
- no GitHub command runs when no explicit base branch was requested.
