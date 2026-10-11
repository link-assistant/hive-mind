---
'@link-assistant/hive-mind': patch
---

Keep AI tool account identifiers out of published logs (#2837). `--verbose` no longer turns on Codex `RUST_LOG=debug` or Claude `ANTHROPIC_LOG=debug`; that SDK tracing is now the separate opt-in `--codex-debug` / `--anthropic-debug`. The publication sanitizer now redacts `user.email`, `user.account_id`, `anthropic-organization-id`, `anthropic-workspace-id` (and the OpenAI account/organization header equivalents), plus the e-mail, account, user and organization IDs of the locally authenticated Codex and Claude accounts wherever they appear, and the publication boundary refuses to publish text that still contains them.
