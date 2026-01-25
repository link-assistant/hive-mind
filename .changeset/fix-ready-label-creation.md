---
'@link-assistant/hive-mind': patch
---

Fix 'ready' label not being created by /merge command

Two bugs prevented the /merge command from creating the 'ready' label:

1. `checkReadyLabelExists()` incorrectly treated GitHub API's 404 JSON error response as the label existing. The function now properly checks for "Not Found" message in the response.

2. `createReadyLabel()` used bash-specific heredoc syntax (`<<<`) which fails in `/bin/sh`. Now uses `gh api -f` flags for shell compatibility.

Fixes #1177
