---
"@link-assistant/hive-mind": patch
---

Fix: Always show claude resume command at end of every session

The console now always displays a copyable claude resume command at the end of every session (success, failure, or usage limit reached):

```
💡 To continue this session in Claude Code interactive mode:

   (cd "/tmp/gh-issue-solver-..." && claude --resume <session-id>)
```

This allows users to:
- Investigate sessions interactively
- Resume from where they left off
- See full context and history
- Debug issues

The command uses the `(cd ... && claude --resume ...)` pattern for a fully copyable, executable command that works regardless of the current directory.

Fixes #942
