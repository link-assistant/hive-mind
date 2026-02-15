---
'@link-assistant/hive-mind': patch
---

Update free models: replace minimax-m2.1-free with minimax-m2.5-free

OpenCode Zen:

- Replace `minimax-m2.1-free` with `minimax-m2.5-free` (M2.1 no longer free)
- Remove `glm-4.7-free` from recommended free models (no longer free)

Kilo Gateway:

- Add `glm-4.5-air-free` (agent-centric model)
- Add `minimax-m2.5-free` (upgraded from M2.1)
- Add `deepseek-r1-free` (advanced reasoning model)

Breaking change: Users relying on `minimax-m2.1-free` or `glm-4.7-free` should switch to the updated models. Deprecated models are kept for backward compatibility but may not work.
