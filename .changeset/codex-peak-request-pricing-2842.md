---
'@link-assistant/hive-mind': patch
---

Fix Codex cost estimates always using long-context pricing. `codex exec` runs one
turn made of many model requests, so `turn.completed.usage.input_tokens` is the
sum of every prompt and was wrongly compared with OpenAI's per-request 272K
threshold. The peak prompt now comes from the per-request `input_token_count` in
Codex `response.completed` SSE diagnostics; without them, the turn total is
capped at the configured `model_context_window` (or the model's context window).
