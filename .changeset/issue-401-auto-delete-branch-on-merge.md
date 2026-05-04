---
'@link-assistant/hive-mind': minor
---

Add `--auto-delete-branch-on-merge` option for the `solve` command. When set together with `--watch`, the branch is deleted from the remote after the pull request is merged; when set together with `--auto-merge`, the auto-merge call requests branch deletion as part of the merge. The option is opt-in (default `false`), enables full GitHub Flow automation, avoids temporary auto-restart cleanup, uses the GitHub REST API for watch-mode deletion, and treats "branch already gone" responses as success so it does not warn when GitHub's "Automatically delete head branches" repo setting beats us to it.
