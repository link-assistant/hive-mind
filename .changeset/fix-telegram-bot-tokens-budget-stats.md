---
'@link-assistant/hive-mind': patch
---

fix: resolve TypeError in telegram-bot when using --tokens-budget-stats

Fixed type safety bug that prevented the --tokens-budget-stats option from working via telegram bot configuration overrides. Changed from lino.parse() to lino.parseStringValues() to ensure only string values are returned, making .trim() safe to call. The feature was already fully implemented but crashed when used via TELEGRAM_HIVE_OVERRIDES or TELEGRAM_SOLVE_OVERRIDES.
