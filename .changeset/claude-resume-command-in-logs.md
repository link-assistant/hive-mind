---
'@link-assistant/hive-mind': patch
---

Fix: Use Claude CLI resume command in logs instead of solve.mjs command

When usage limit is reached or Claude command fails, the log now shows
the Claude CLI resume command:

```bash
(cd "/tmp/gh-issue-solver-..." && claude --resume session-id)
```

Instead of the solve.mjs command format that was previously shown:

```bash
/home/hive/.../node /home/hive/.bun/bin/solve https://... --resume session-id
```

This allows users to:

- Resume directly using Claude CLI in interactive mode
- Investigate sessions interactively in the working directory
- Continue work after usage limits reset

The Claude CLI resume command is now captured in the logs that get uploaded
to PR comments, making it easy for users to find and use.

Fixes #942
