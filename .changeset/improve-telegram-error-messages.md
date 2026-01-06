---
'@link-assistant/hive-mind': patch
---

Improve Telegram bot error messages for better user experience (issue #1070)

- Enhanced URL validation to provide specific, actionable error messages based on URL type (issues list, pulls list, repository)
- Added step-by-step fix instructions with examples when users provide wrong URL formats
- Improved global error handler to properly escape Markdown special characters, preventing "400: Bad Request: can't parse entities" errors
- Added special handling for Telegram API parsing errors with clearer messaging
- Added `cleanNonPrintableChars()` to automatically remove invisible Unicode characters from user input
- Added `makeSpecialCharsVisible()` to show users exactly where problematic special characters are in their input
- Enhanced error messages to display user input with special characters made visible for easier debugging
- Refactored telegram-bot.mjs to meet 1500 line limit requirement
- Created comprehensive test suites to verify URL validation improvements and special character handling
- Documented case study analysis in docs/case-studies/issue-1070/ANALYSIS.md
