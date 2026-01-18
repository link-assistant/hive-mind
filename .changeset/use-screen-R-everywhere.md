---
"@link-assistant/hive-mind": patch
---

Use `screen -R` instead of `screen -S` and `screen -r` in all docs and code for better session management. The `-R` flag ensures we open existing screen if created, and new if not yet created, making it the most safe and universal option.
