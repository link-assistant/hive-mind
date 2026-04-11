---
'@link-assistant/hive-mind': patch
---

fix: make usage limit footer message consistent with auto-resume mode (#1569)

- Fix footer message in "Usage Limit Reached" GitHub comments to reflect auto-resume/auto-restart mode
- Previously the footer always showed "You can resume once the limit resets." even when auto-resume was enabled
- Now shows mode-specific messages: "The session will automatically resume when the limit resets." or "The session will automatically restart when the limit resets."
