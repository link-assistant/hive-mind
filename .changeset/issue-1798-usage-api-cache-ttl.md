---
'@link-assistant/hive-mind': patch
---

Increase the default `HIVE_MIND_USAGE_API_CACHE_TTL_MS` from 10 → 13 minutes so the Claude Usage API (`/api/oauth/usage`) is queried less frequently and we stop tripping the upstream "Resets in 3m Xs" rate-limit message. Operators can still override the value via the environment variable. Resolves #1798.
