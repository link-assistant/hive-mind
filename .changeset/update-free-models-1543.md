---
'@link-assistant/hive-mind': minor
---

feat: update free models for --tool agent, set qwen3.6-plus-free as default (#1543)

- Change default agent model from `minimax-m2.5-free` to `qwen3.6-plus-free` (~1M context window)
- Add `qwen3.6-plus-free` (Alibaba Qwen, ~1M context) to free models
- Add `nemotron-3-super-free` (NVIDIA hybrid Mamba-Transformer, ~262K context) to free models
- Update documentation, tests, and provider priority lists
- Syncs with upstream agent PR #234
