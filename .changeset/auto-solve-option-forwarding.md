---
'@link-assistant/hive-mind': minor
---

feat: automatic solve option forwarding from hive config (issue #1209)

Refactored hive-to-solve option forwarding to be fully automatic. New solve options are now
automatically available in hive and TELEGRAM_HIVE_OVERRIDES without manual code changes.

- Extracted `SOLVE_OPTION_DEFINITIONS` from solve.config.lib.mjs as a shared data structure
- hive.config.lib.mjs auto-registers all solve options (minus hive-only and solve-only exclusions)
- hive.mjs uses a generic forwarding loop instead of per-option if statements
- Added `getSolvePassthroughOptionNames()` export for programmatic access to passthrough list
