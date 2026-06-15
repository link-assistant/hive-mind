---
"@link-assistant/hive-mind": patch
---

Fail Claude working sessions immediately when Playwright MCP is enabled but the actual `system.init` event reports Playwright as pending or missing without browser tools.

Fall back to a compatible cached `use-m` bootstrap when the upstream latest `/use.js` entrypoint is unavailable.
