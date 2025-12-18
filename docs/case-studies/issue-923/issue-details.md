# Issue #923: Backslash in URL Handling

## Issue Details
- **Title**: We should fail on `\` in the url (which are not part of hash or query parameters).
- **Reporter**: User encountered issue with URL containing backslash
- **Example URL**: `https://github.com/konard/hh-job-application-automation/issues/124\`

## Problem Description
When a user provides a URL with a backslash at the end (or in the path), the system doesn't properly validate it and instead tries to parse raw HTML content, showing div classes and other HTML markup instead of the expected GitHub issue content.

## Requirements
1. Detect backslashes in URLs (excluding hash and query parameters)
2. Fail with clear error message when backslash is detected
3. Suggest using the URL without backslash if it parses correctly
4. Implement in:
   - hive-telegram-bot
   - hive command
   - solve command
5. Ensure universal parser supports this validation

## Screenshot Analysis
The screenshot shows:
- User command: `/solve https://github.com/konard/hh-job-application-automation/issues/124\`
- System response shows raw HTML content instead of issue details
- The backslash at the end causes parsing failure
