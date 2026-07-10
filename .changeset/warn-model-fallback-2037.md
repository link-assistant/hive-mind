---
'@link-assistant/hive-mind': patch
---

Improve model capacity fallback handling (Issue #2037): when the requested model is temporarily unavailable, every tool now retries the originally-requested model up to 5 times with exponential backoff before switching, then walks a fallback chain ordered by intelligence/size tier (e.g. `gpt-5.6-sol → gpt-5.6-terra → gpt-5.5 → gpt-5.4 → gpt-5.2`, skipping the smaller `gpt-5.6-luna` variant), keeps the mismatch warning informative rather than alarming, retries quickly after a capacity-driven model switch, and reports the fallback model's share of output tokens. Includes a case study reconstructing the timeline and root causes.
