---
"@link-assistant/hive-mind": patch
---

Add per-tool concurrency mode to the solve queue. The `--tool agent` queue now defaults to **global one-at-a-time** so free-tier providers (OpenCode Zen, Kilo Gateway) aren't rate-limited by parallel runs. The new mode `per-free-model-one-at-a-time` runs one task at a time per free model (e.g. one `minimax-m2.5-free`) while letting different free models (e.g. `gpt-5-nano-free`) run in parallel. Configurable for every queue via env vars (`HIVE_MIND_<TOOL>_CONCURRENCY`) and the existing `HIVE_MIND_QUEUE_CONFIG` links notation (`(agent-concurrency per-free-model-one-at-a-time)`). Other tools (claude/codex/qwen/gemini) keep their previous behavior by defaulting to `off`. Closes #1474.
