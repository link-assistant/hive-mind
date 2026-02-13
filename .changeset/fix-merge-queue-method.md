---
'@link-assistant/hive-mind': patch
---

fix: add --merge flag to gh pr merge command to prevent "not running interactively" error (Issue #1269)

The merge queue was stuck because `gh pr merge` requires an explicit merge method flag
(`--merge`, `--squash`, or `--rebase`) when running in a non-interactive context.
Without a merge method, the command would fail with:
"--merge, --rebase, or --squash required when not running interactively"

This fix:

- Adds `--merge` flag by default to the `mergePullRequest()` function
- Adds `mergeMethod` option to configure the merge strategy ('merge', 'squash', 'rebase')
- Adds `HIVE_MIND_MERGE_QUEUE_MERGE_METHOD` environment variable for configuration
