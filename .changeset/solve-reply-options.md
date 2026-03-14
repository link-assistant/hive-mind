---
'@link-assistant/hive-mind': minor
---

Support all options via /solve command when replying to a message containing a GitHub link (issue #1325)

Previously, `/solve` as a reply only worked when used without any arguments. Now users can reply to a message containing a GitHub issue/PR link with `/solve --model opus` or any other options, and the bot will:

1. Extract the GitHub URL from the replied message
2. Use the provided options
3. Execute the solve command with both the extracted URL and the user-provided options
