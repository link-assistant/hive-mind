---
"@link-assistant/hive-mind": patch
---

Fix start-screen URL validation to accept user and organization GitHub URLs

The `start-screen hive` command was rejecting valid user/org URLs like `https://github.com/konard` with "Invalid GitHub URL: missing owner/repo". This fix updates `start-screen.mjs` to use the shared `parseGitHubUrl` from `github.lib.mjs`, ensuring consistent URL validation across `hive`, `solve`, and `start-screen` commands. Tests for `--dry-run` mode added for both `solve` and `hive` commands.
