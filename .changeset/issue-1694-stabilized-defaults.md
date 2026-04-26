---
'@link-assistant/hive-mind': patch
---

Make four stabilized options enabled by default (issue #1694): `--auto-accept-invite`, `--tokens-budget-stats`, and `--auto-attach-solution-summary` now default to `true` for `solve` and `hive` (use `--no-…` to disable), and the `hive-telegram-bot`'s `--isolation` defaults to `screen` (set `TELEGRAM_ISOLATION=` or pass `--isolation ''` to disable). The Telegram `/solve` auto-accept-invite pre-check now reads the parsed `argv` so the new default fires without an explicit `--auto-accept-invite` and `--no-auto-accept-invite` works as a real opt-out.
