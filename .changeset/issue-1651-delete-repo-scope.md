---
'@link-assistant/hive-mind': patch
---

Issue #1651: When fork-parent auto-recovery tries to delete the mismatched
fork and the GitHub CLI token is missing the `delete_repo` scope, `solve`
now prints the real remediation (`gh auth refresh -h github.com -s delete_repo`)
plus a non-destructive alternative (rename/archive + `--prefix-fork-name-with-owner-name`)
instead of re-recommending the same `gh repo delete` command that just failed.
In `--verbose` mode the full `gh` output is also printed so future root-cause
analyses have the diagnostic lines GitHub already provides.
