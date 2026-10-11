---
'@link-assistant/hive-mind': patch
---

Fix hive-cleanup losing the session details of Docker isolation containers whose command only named a repository (issue #2844). Every `$ --list` session now produces a record (repo, session, status, exit code, workspace), parsing `github.com/<owner>/<repo>` even when it is shell-quoted and has no issue/PR number. For `fix` and `hive` sessions, the issue/PR the session created is recovered from its start-command log ("✅ Created issue: …", "PR created: #N" / "PR URL: …"), and the container summary shows it as `owner/repo PR #N (issue #M)`. The cleanup log is now written to `$HIVE_MIND_LOG_DIR` (default `~/.hive-mind/logs`, override with `--log-dir`) instead of next to the script in `~/.bun/bin`, and the docker heading reads `(mode: succeeded)` so it no longer looks like an outcome.
