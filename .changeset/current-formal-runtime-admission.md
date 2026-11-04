---
"@link-assistant/hive-mind": patch
---

Reject missing or invalid draft image selections instead of substituting latest, while keeping bounded retries and explicit image overrides. Expose distinct errors for unavailable selected images and exhausted pull retries, and refresh the dependency versions required by CI.
