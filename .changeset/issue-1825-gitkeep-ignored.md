---
'@link-assistant/hive-mind': patch
---

Fix "Failed to add .gitkeep" abort during auto-PR creation when the target repository's `.gitignore` matches the seed placeholder (issue #1825). Placeholder staging now routes through `addPlaceholderFileToGit`, which detects the ignored path with `git check-ignore` and retries with `git add -f`. Because the placeholder is created by the solver to seed the initial commit and removed once the task completes, force-adding it is safe.
