# Analysis

## User-visible symptom

The Telegram screenshot shows the command:

```text
/claude https://github.com/Payel-git-ol/Octra/issues/107 --model opus --base-branch create/new-concept --auto-merge
```

The completion summary later showed the options, but the user reported that the base branch and auto-merge were ignored.

## What happened

The setup path honored `--base-branch`:

- `createOrCheckoutBranch` created the work branch from `create/new-concept`.
- `handleAutoPrCreation` compared against `create/new-concept`.
- `gh pr create` included `--base create/new-concept`.
- GitHub's API response confirmed `base.ref: create/new-concept`.

The agent then overrode the target. The working-session log includes the agent's reasoning that the branch was a cleaner descendant of `master`, followed by:

```text
gh pr edit 108 --repo Payel-git-ol/Octra --base master
```

After this, `gh pr view` showed:

```json
{ "baseRefName": "master", "isDraft": false, "mergeStateStatus": "UNSTABLE", "mergeable": "MERGEABLE", "state": "OPEN" }
```

The `--auto-merge` path did run, but it ran after that retarget. Because the PR was from a fork, hive-mind correctly stopped with the fork no-write-access handoff. The issue is that the handoff was now attached to a PR targeting `master` instead of the requested `create/new-concept`.

## Root causes

1. The system prompts treated PR title/body updates as agent work but did not state that `--base-branch` is immutable once explicitly requested.
2. The prompts included generic finalization advice to merge or compare against the default branch, which made the agent's retargeting decision look reasonable.
3. There was no runtime verification between the agent session and `verifyResults`/auto-merge to detect that the PR base had changed.
4. A verbose line in auto PR creation logged `Base branch: master` even when the actual target branch was `create/new-concept`, which made log review harder.

## Requirements derived from the issue

- Preserve explicit `--base-branch` through the full solve lifecycle.
- Do not let an agent replace `--auto-merge` with a manual readiness workflow.
- Detect and repair retargeting before result verification and auto-merge.
- Keep the fix broad enough for Claude, Codex, Gemini, OpenCode, Agent, and Qwen prompt builders.
- Add a regression test that reproduces the issue mechanism.

## Non-goals

- Do not change behavior when no explicit `--base-branch` is provided. Existing PRs without a user-locked base may intentionally target a non-default branch.
- Do not prevent legitimate title/body edits through `gh pr edit`.
- Do not attempt to force-merge fork PRs; fork permission limitations remain valid.
