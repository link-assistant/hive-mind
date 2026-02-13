---
'@link-assistant/hive-mind': patch
---

Fix agent tool error handling: upload failure logs to PR even when sessionId is not available

- Remove overly strict sessionId requirement for failure log upload in solve.mjs
- Add FreeUsageLimitError pattern detection for Agent/OpenCode Zen rate limits
- Improve rate limit detection by checking multiple sources (lastMessage, errorMatch, fullOutput)
- Add comprehensive case study documentation for issue #1287
- Add tests for FreeUsageLimitError detection
