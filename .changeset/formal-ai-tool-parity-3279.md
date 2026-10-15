---
'@link-assistant/hive-mind': patch
---

Formal AI now behaves the same through `--tool claude`, `--tool codex` and `--tool agent` (issue #3279): commits made during a Claude Code or Codex CLI session carry the same four Formal-AI trailers and the same evidence bundle (with a `claude-stream.jsonl` or `codex-stream.jsonl` stream) that Agent CLI sessions already had, and the hosted-model guard now checks the model and the generations that really answered instead of rejecting the client name. Prices for models served outside a client's own vendor live in one registry keyed by the served model, so a Formal AI session costs $0.00 (Link.Assistant) in every client, and a non-Anthropic model behind a non-Anthropic `ANTHROPIC_BASE_URL` no longer inherits Claude Code's Anthropic list price.
