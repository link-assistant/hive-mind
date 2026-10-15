---
'@link-assistant/hive-mind': minor
---

`/fix --ci-cd` and `/fix --update-all-dependencies` no longer create duplicate issues and wait for default-branch CI/CD before the task starts (#3326):

- Issue creation checks which issue types the repository supports before passing `--type` (user-owned repositories have none), and when `gh issue create` fails it first looks for the issue it may already have created instead of blindly retrying. `gh` 2.102.0 creates the issue and only then fails with `type "Bug" not found`, which used to produce a second, label-less issue (reported upstream as cli/cli#14703).
- `/fix` creates the issue right away, then waits for running CI/CD on the default branch to finish (polling every 30 s, `--ci-wait-timeout <minutes>`, default 60; `--no-wait-for-ci` to skip) and comments the final results on the issue before `/solve` starts.
- Telegram shows the separate "⏳ Waiting for CI/CD on `main` to finish" status with the running workflows and elapsed time, then the CI result and the issue link (en/ru/zh/hi).
