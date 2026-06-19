---
"@link-assistant/hive-mind": patch
---

Fix Claude public cost estimates for 1-hour prompt-cache writes by pricing `cache_creation.ephemeral_1h_input_tokens` at the documented 2x input rate instead of the 5-minute cache-write rate.
