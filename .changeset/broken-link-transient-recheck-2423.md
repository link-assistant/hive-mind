---
'@link-assistant/hive-mind': patch
---

Broken Link Checker: re-check links lychee reported with a transient failure (429, 5xx, connection error) with backoff and, for github.com blob/tree pages, via the authenticated GitHub contents API, so GitHub's 503 throttling no longer turns `main` red (#2423).
