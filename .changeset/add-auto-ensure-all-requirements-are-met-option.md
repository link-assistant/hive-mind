---
'@link-assistant/hive-mind': minor
---

feat: add --finalize option (Issue #1383)

Adds new experimental CLI options to the `solve` command:

- `--finalize [N]`: After the main solve completes, automatically restarts the AI tool N times (default: 1 when used as a flag) with a requirements-check prompt to verify all requirements are met. Uses the same model as `--model` by default.
- `--finalize-model`: Override the model used during `--finalize` iterations (defaults to `--model`).
- `--prompt-ensure-all-requirements-are-met`: Adds a system prompt hint in the "Self review" section instructing the AI to ensure all changes are correct, consistent, validated, tested, logged and fully meet all discussed requirements. Enabled automatically during `--finalize` iterations only (not the first regular run).

This forces the AI tool to double-check itself after the main solve, verifying changes meet all requirements from the issue description and PR comments, and that CI/CD checks pass.
