---
'@link-assistant/hive-mind': minor
---

feat: add --auto-ensure-all-requirements-are-met option (Issue #1383)

Adds two new experimental CLI options to the `solve` command:

- `--auto-ensure-all-requirements-are-met [N]`: After the main solve completes, automatically restarts the AI tool N times (default: 1 when used as a flag) with a prompt to verify all requirements are met. Implies `--prompt-ensure-all-requirements-are-met`.
- `--prompt-ensure-all-requirements-are-met`: Adds a system prompt hint in the "Self review" section instructing the AI to ensure all changes are correct, consistent, validated, tested, logged and fully meet all discussed requirements when no explicit feedback is provided.

This forces the AI tool to double-check itself, verifying changes meet all requirements from the issue description and PR comments, and that CI/CD checks pass.
