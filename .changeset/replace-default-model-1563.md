---
'@link-assistant/hive-mind': minor
---

feat: replace deprecated qwen3.6-plus-free default with nemotron-3-super-free for --tool agent (#1563)

- Change default agent model from `qwen3.6-plus-free` to `nemotron-3-super-free` (~262K context, NVIDIA hybrid Mamba-Transformer)
- Move `qwen3.6-plus-free` to deprecated (free promotion ended April 2026, now requires OpenCode Go subscription)
- Update documentation, tests, and model priority lists
- Syncs with upstream agent PR #243
