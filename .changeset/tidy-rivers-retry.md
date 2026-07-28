---
'@link-assistant/hive-mind': patch
---

Recover use-m dependency imports when an installed package is missing an internal module or alias cleanup hits a transient filesystem race by removing the incomplete alias with bounded retries and reloading it.
