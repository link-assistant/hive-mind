---
'@link-assistant/hive-mind': patch
---

Fix: Show claude resume command at end of every session when using --tool claude

When using `--tool claude` (or the default tool), the console now displays a copyable claude resume command at the end of every session (success, failure, or usage limit reached):

```
💡 To continue this session in Claude Code interactive mode:

   (cd "/tmp/gh-issue-solver-..." && claude --resume <session-id>)
```

This allows users to:

- Investigate sessions interactively in Claude Code
- Resume from where they left off
- See full context and history
- Debug issues

The command uses the `(cd ... && claude --resume ...)` pattern for a fully copyable, executable command that works regardless of the current directory. This is the same pattern used when `--resume` is passed to solve.mjs.

Note: The resume command is only shown for `--tool claude` since other tools (codex, opencode, agent) have different resume mechanisms.

Fixes #942
