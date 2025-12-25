---
'@link-assistant/hive-mind': patch
---

Fix: Show Claude CLI resume command using `(cd ... && claude --resume ...)` pattern

When using `--tool claude` (or the default tool), the console now displays a copyable Claude CLI resume command at the end of every session (success, failure, or usage limit reached):

```
💡 To continue this session in Claude Code interactive mode:

   (cd "/tmp/gh-issue-solver-..." && claude --resume <session-id>)
```

Changes in this PR:

- Refactored `claude.command-builder.lib.mjs` to build Claude CLI commands instead of solve.mjs commands
- Added `buildClaudeResumeCommand()` for generating `(cd ... && claude --resume ...)` pattern
- Added `buildClaudeInitialCommand()` for generating `(cd ... && claude ...)` pattern
- Removed solve.mjs resume command display from console output
- Updated PR comments to use Claude CLI resume command pattern

This allows users to:

- Investigate sessions interactively in Claude Code
- Resume from where they left off after usage limits reset
- See full context and history
- Debug issues

The command uses the `(cd ... && claude --resume ...)` pattern for a fully copyable, executable command that works regardless of the current directory.

Note: The resume command is only shown for `--tool claude` since other tools (codex, opencode, agent) have different resume mechanisms.

Fixes #942
