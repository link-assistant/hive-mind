---
'@link-assistant/hive-mind': patch
---

Fix auto-PR creation failure on fork-of-fork repositories. When `solve` runs against an issue in a repository that is itself a GitHub fork and the user has direct write access, `gh pr create` previously resolved the base repository to the upstream parent (because `gh repo clone` auto-adds an `upstream` remote for forks), producing a misleading "No commits between" error. The auto-PR command builder now always passes `--repo ${owner}/${repo}` so the PR is created against the explicit target. The fatal error block also detects the failure mode and prints a fork-aware diagnostic with the resolved remotes and a manual recovery command.
