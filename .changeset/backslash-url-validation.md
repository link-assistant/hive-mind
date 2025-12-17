---
"@link-assistant/hive-mind": patch
---

Add backslash detection and validation in GitHub URLs

When users provide URLs with backslashes (e.g., `https://github.com/owner/repo/issues/123\`), the system now properly validates them and provides helpful error messages with auto-corrected URL suggestions. According to RFC 3986, backslash is not a valid character in URL paths.

**Changes:**
- Enhanced `parseGitHubUrl()` function to detect backslashes in URL paths
- Updated all validation points (Telegram bot `/solve` and `/hive` commands, CLI `hive` and `solve` commands)
- Provides user-friendly error messages with corrected URL suggestions
- Comprehensive test suite for backslash validation scenarios

Fixes #923
