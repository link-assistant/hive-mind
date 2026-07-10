---
'@link-assistant/hive-mind': patch
---

Fix `--think` validation asymmetry between `solve` and `hive` (Issue #2041). After the #2038 vocabulary refactor, `solve.config` only validated `--think` in the CLI `parseArguments()` path, so consumers that parse solve options directly through the yargs config — most notably the Telegram bot — silently accepted invalid `--think` values (a CI false-negative that failed `test-telegram-options-before-url`). `createYargsConfig` now runs the same `normalizeAndValidateThink` `.check()` that `hive.config` already used, and `parseArguments` propagates that validation error verbatim instead of swallowing it. Invalid `--think` values are now rejected consistently on the CLI and Telegram paths.
