---
'@link-assistant/hive-mind': patch
---

Improve model capacity fallback handling (Issue #2037): when the requested model is temporarily unavailable, the fallback now walks a closest-first chain, keeps the mismatch warning informative rather than alarming, retries quickly after a capacity-driven model switch, and reports the fallback model's share of output tokens. Includes a case study reconstructing the timeline and root causes.
