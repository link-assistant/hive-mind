---
'@link-assistant/hive-mind': minor
---

Add `--working-directory` / `-d` option for proper session resume

Claude Code stores sessions per-directory path, so resuming a session in a different directory fails. This change:

1. Adds `--working-directory` / `-d` option to solve.mjs
   - If directory exists with git repo, uses it without cloning
   - If directory exists but empty, clones into it
   - If directory doesn't exist, creates it and clones

2. Updates `--auto-resume-on-limit-reset` to pass `--working-directory`
   - When limit resets and session auto-resumes, it uses the same directory as the original session
   - This ensures Claude Code can find and resume the session

3. Improves resume error messaging
   - Warns when resuming without --working-directory
   - Explains that Claude Code sessions are tied to directory paths

Example usage:

```bash
./solve.mjs "<url>" --resume <session-id> --working-directory /tmp/gh-issue-solver-123
```
