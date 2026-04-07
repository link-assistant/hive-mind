---
'@link-assistant/hive-mind': patch
---

Fix wrong context window calculation showing impossible percentages like 250% (Issue #1539). When peakContextUsage is unknown (e.g. sub-agent models from result JSON only), skip the context window input tokens display entirely instead of falling back to cumulative totals across all requests, which are not valid per-request context window metrics.
