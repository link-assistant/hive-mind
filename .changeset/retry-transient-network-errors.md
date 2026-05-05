---
'@link-assistant/hive-mind': patch
---

Retry transient 5xx/network errors across all `gh` exec sites. Previously a single 504 from the GitHub GraphQL endpoint could abort `solve` during `gh pr create`. The retry helper now handles HTTP 502/503/504, socket hang up, ECONNRESET, ETIMEDOUT, and TLS handshake timeouts in addition to rate-limit errors, with a separate retry budget and exponential backoff. All direct `execAsync('gh ...')` sites are routed through `execGhWithRetry`.
