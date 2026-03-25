---
'@link-assistant/hive-mind': patch
---

fix: fix model recognition logic and update free models docs (Issue #1473)

- Fix `resolveModelId()` in `src/model-info.lib.mjs` to use `mapModelForTool()` from `model-mapping.lib.mjs` as single source of truth instead of duplicated hardcoded maps that were missing agent free model mappings
- Fix false warning "Main model does not match requested model" for agent free models (e.g., `kimi-k2.5-free` → `opencode/kimi-k2.5-free`)
- Add missing base model pricing mappings for `minimax-m2.5-free`, `glm-5-free`, `glm-4.5-air-free`, `deepseek-r1-free`, `giga-potato-free` in `getBaseModelForPricing()`
- Update `validateAgentConnection()` default model to `minimax-m2.5-free`
- Update `docs/FREE_MODELS.md` to sync with upstream [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md)
- Update README.md examples to use `minimax-m2.5-free` instead of deprecated `kimi-k2.5-free`
