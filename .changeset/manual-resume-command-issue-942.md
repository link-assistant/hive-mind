---
"@link-assistant/hive-mind": patch
---

Fix: Show manual resume command in console when usage limit is reached

When the usage limit is reached and `--auto-continue-on-limit-reset` is NOT enabled, the console now displays:
- Working directory path
- Session ID
- Reset time (if available)
- A copyable manual resume command
- An auto-continue variant of the command

This allows users to manually resume their session after the limit resets, addressing issue #942.
