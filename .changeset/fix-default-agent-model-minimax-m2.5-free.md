---
'@link-assistant/hive-mind': patch
---

fix: update default agent model to minimax-m2.5-free (Issue #1391)

`kimi-k2.5-free` is no longer supported by OpenCode Zen and returns a `ModelError` (HTTP 401). The new default for `--tool agent` is now `minimax-m2.5-free`, matching the upstream fix in [agent PR #209](https://github.com/link-assistant/agent/pull/209).

- `minimax-m2.5-free` is now the default model for `--tool agent`
- `kimi-k2.5-free` is moved to the deprecated backward-compatibility section across all model maps
- Updated `docs/FREE_MODELS.md` to reflect the new default and document `kimi-k2.5-free` as discontinued
