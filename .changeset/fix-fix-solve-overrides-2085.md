---
'@link-assistant/hive-mind': patch
---

fix(telegram): apply operator `TELEGRAM_SOLVE_OVERRIDES` to the `/solve` started by `/fix` (#2085)

`/fix --ci-cd` genuinely spawns the real `solve.mjs`, but the Telegram bot's
operator solve overrides (e.g. `--attach-logs`) were only merged into `/solve`
and `/hive` — never `/fix`. As a result the solve launched by `/fix` ran
without the operator's defaults. The `mergeArgsWithOverrides` helper is now
extracted into a shared `src/args-overrides.lib.mjs` module and the `/fix`
handler applies `solveOverrides` (including an optional `--isolation` override)
exactly like `/solve` does, restoring the missing defaults.
