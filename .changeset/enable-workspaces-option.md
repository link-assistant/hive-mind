---
'@link-assistant/hive-mind': minor
---

Add --enable-workspaces option for separate workspace directories

This feature adds support for creating separate workspace directories when using `--tool opencode`. When enabled with `--enable-workspaces`, the tool creates a structured workspace:

- `/tmp/hive-mind-solve-gh-{owner}/{repo}-issue-{issueNumber}-workspace-{timestamp}/repository` - for the cloned repo
- `/tmp/hive-mind-solve-gh-{owner}/{repo}-issue-{issueNumber}-workspace-{timestamp}/tmp` - for temp files, logs, downloads

The workspace tmp directory is passed to OpenCode prompts, with explicit examples for saving CI logs, diffs, and command outputs.
