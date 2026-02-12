---
'@link-assistant/hive-mind': patch
---

Fix `--tool agent` pricing display for free models (Issue #1250)

- Add base model pricing lookup for free model variants (e.g., `kimi-k2.5-free` → `kimi-k2.5`)
- Show actual market price as "Public pricing estimate" based on the underlying paid model
- Display base model reference in cost output: "(based on Moonshot AI kimi-k2.5 prices)"
- Distinguish between truly free models and free access to paid models
- Fix token usage showing "0 input, 0 output" by accumulating tokens during streaming
- Token accumulation now happens in real-time as step_finish events arrive, avoiding NDJSON concatenation issues
