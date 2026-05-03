---
'@link-assistant/hive-mind': minor
---

Add `--auto-delete-branch-on-merge` option for the `solve` command. When set together with `--watch`, the branch is deleted from the remote after the pull request is merged, enabling full GitHub Flow automation. The option is opt-in (default `false`), only takes effect in true `--watch` mode (not auto-restart), uses the GitHub REST API, and treats "branch already gone" responses as success so it does not warn when GitHub's "Automatically delete head branches" repo setting beats us to it.
