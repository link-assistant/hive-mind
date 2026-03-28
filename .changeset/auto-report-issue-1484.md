---
'@link-assistant/hive-mind': minor
---

feat: add --auto-report-issue and --disable-report-issue flags for non-interactive error reporting (Issue #1484)

- Add `--auto-report-issue` flag that automatically creates a GitHub issue on failure without prompting.
  The auto-reported issue includes error details, logs, and case study analysis instructions in the body.
  Issue is labeled as `bug`.
- Add `--disable-report-issue` flag that completely disables error issue creation (no prompt, no auto-creation).
  Takes precedence over `--auto-report-issue` if both are specified.
- Default behavior (neither flag) preserves the existing interactive y/n prompt.
- Both flags are automatically available as passthrough options in hive and TELEGRAM_HIVE_OVERRIDES.
