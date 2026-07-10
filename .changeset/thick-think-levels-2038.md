---
'@link-assistant/hive-mind': minor
---

`--think` now accepts a richer, provider-neutral vocabulary (Issue #2038): the off synonyms `off`/`disable`/`disabled`/`no`/`none` all mean disabled (or the closest safe equivalent when a model cannot truly disable thinking), a new `minimal` tier below `low` (Codex `minimal` reasoning; Claude lowest effort with a ~4000-token budget), a first-class `adaptive` mode that requests provider-managed adaptive thinking and fails fast for `solve`/`hive` on models/tools that do not support it (only adaptive-only Claude models: Opus 4.7+, Fable 5, Mythos 5, Sonnet 5), and numeric intensities for precision — percentages `0%`..`100%`, fractions `0.0`..`1.0`, and the integers `0` (off) and `1` (max). Normalization is applied consistently for both `solve` and `hive`.
