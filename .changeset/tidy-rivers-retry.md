---
'@link-assistant/hive-mind': patch
---

Recover use-m dependency imports when an installed package is missing an internal module or alias cleanup hits a transient filesystem race by removing the incomplete alias with bounded retries and reloading it. The CDN bootstrap fallback is also repinned from use-m 8.13.8 to 8.14.4 so a CDN outage no longer downgrades dependency loading to a use-m without corrupt-alias recovery.
