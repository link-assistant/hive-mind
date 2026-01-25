---
'@link-assistant/hive-mind': minor
---

Add auto-labeling feature to /merge command

When no PRs have the 'ready' label, the /merge command now automatically:

1. Searches for eligible PRs (not drafts, passing CI, no merge conflicts)
2. Adds the 'ready' label to eligible PRs
3. Re-initializes the merge queue to process them

New functions added:

- `fetchAllOpenPRs`: Fetches all open PRs in a repository
- `addLabelToPR`: Adds a label to a specific PR
- `checkPREligibleForAutoLabel`: Checks if a PR meets criteria for auto-labeling
- `autoLabelEligiblePRs`: Orchestrates the auto-labeling process
