---
"@link-assistant/hive-mind": patch
---

Fix incorrect usage-limit reset time for `--tool codex`. Codex reports weekly limits as a full calendar date (e.g. "try again at Jun 11th, 2026 12:27 AM"), but the reset-time parser dropped the month/day/year and kept only the time, making a multi-day weekly reset look like a same-day 5-hour reset. This both mis-informed users and made auto-resume fire far too early. `extractResetTime` now parses ordinal days and explicit years (keyword-independent), `parseResetTime` honors an explicit year, and Codex now traces the raw limit message and parsed reset under verbose mode.
</content>
