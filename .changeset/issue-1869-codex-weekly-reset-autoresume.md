---
"@link-assistant/hive-mind": patch
---

Fix the auto-resume wait calculation for weekly `--tool codex` usage limits (Issue #1869, phase 2). After the display parser was fixed to keep the full reset date, the separate auto-resume parser in `solve.validation.lib.mjs` still crashed with `Invalid time format: Jun 11, 2026, 12:27 AM` and, even when it parsed, discarded the date and scheduled for today/tomorrow — so auto-resume woke up far too early. `calculateWaitTime` now delegates to the robust date-aware `parseResetTime` from `usage-limit.lib.mjs` (honoring explicit year, weekly date, and timezone) and returns the real time-until-reset, and all three call sites now forward the timezone. This consolidates onto a single reset-time parser.
