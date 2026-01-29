---
'@link-assistant/hive-mind': patch
---

Skip Claude API limits for --tool agent tasks in queue

- Agent tools (Grok Code, OpenCode Zen) use different backends with their own rate limits
- Add tool parameter to canStartCommand() and checkApiLimits() functions
- Skip Claude-specific limits (5-hour session, weekly) when tool is 'agent'
- Consumer loop now passes next queue item's tool to limit checks
- Add 7 new tests for tool-specific limit handling
- Add case study documentation

Fixes #1159
