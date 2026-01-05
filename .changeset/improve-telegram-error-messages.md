---
'@link-assistant/hive-mind': patch
---

Improve Telegram bot error messages for better user experience (issue #1070)

- Enhanced URL validation to provide specific, actionable error messages based on URL type (issues list, pulls list, repository)
- Added step-by-step fix instructions with examples when users provide wrong URL formats
- Improved global error handler to properly escape Markdown special characters, preventing "400: Bad Request: can't parse entities" errors
- Added special handling for Telegram API parsing errors with clearer messaging
- Created comprehensive test suite to verify URL validation improvements
- Documented case study analysis in docs/case-studies/issue-1070/ANALYSIS.md
