---
"@link-assistant/hive-mind": patch
---

Fix false positive error detection when agent recovers from transient errors (Issue #1276)

- Trust exit code 0 as authoritative indicator of success even if errors occurred during execution
- Clear streaming error detection when agent completes successfully (emits session.idle or "exiting loop")
- Fix message extraction to prefer "error" field over "message" field for agent error events
- Add tests for agent recovery scenarios and false positive prevention
