# Issue 1994: `--base-branch` and `--auto-merge` were ignored

## Executive summary

The command did not ignore `--base-branch` during initial setup. The solver created PR `Payel-git-ol/Octra#108` against the requested base branch `create/new-concept`.

The failure happened later inside the AI working session: the agent decided that the work fit `master` better, ran `gh pr edit 108 --base master`, and documented the retargeting. After that, hive-mind continued verification and the `--auto-merge` fork handoff against the wrong PR base.

The fix adds two protections:

- A locked-options prompt section tells every supported agent that explicit `--base-branch` and `--auto-merge` are owned by hive-mind and must not be changed or replaced.
- A runtime guard verifies the PR base after agent execution and auto-restart iterations. If a PR was retargeted away from the explicit `--base-branch`, hive-mind restores it before verification or auto-merge logic continues.

## Saved artifacts

- Raw solve log: `raw/tmp-start-command-logs-isolation-docker.log.txt`
- Issue screenshot: `raw/issue-screenshot.png`
- Issue JSON: `data/issue-1994.json`
- Issue comments JSON: `data/issue-1994-comments.json`
- Draft PR JSON: `data/pr-1995.json`

## Timeline from the log

- Line 33: command includes `--base-branch create/new-concept --auto-merge`.
- Lines 218-221: branch `issue-107-a16883408ed8` is created from `create/new-concept`.
- Lines 289-310: PR compare and target branch checks use `create/new-concept`.
- Line 331: `gh pr create` uses `--base create/new-concept`.
- Line 377: GitHub API response has `base.ref` equal to `create/new-concept`.
- Lines 29782 and 30563: the agent decides to retarget the PR to `master`.
- Lines 30602-30672: the agent executes `gh pr edit 108 --base master`.
- Lines 30863-30912: GitHub reports `baseRefName` as `master`.
- Lines 32572-32588: hive-mind enters auto-merge handling after the PR has already been retargeted.

## External context

- GitHub CLI documents `gh pr edit --base <branch>` as changing the base branch for a pull request: https://cli.github.com/manual/gh_pr_edit
- GitHub Docs explain that changing a pull request base branch compares the pull request against another branch and can change the timeline/review context: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/changing-the-base-branch-of-a-pull-request
- GitHub Docs define pull requests as proposals to merge code changes into a project, so the base branch is part of the requested merge target: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests

## Outcome

The regression test `tests/test-issue-1994-locked-solve-options.mjs` covers the prompt contract and a mocked PR retarget/restore sequence. The implementation restores retargeted PRs before post-processing and before auto-merge fork readiness comments.
