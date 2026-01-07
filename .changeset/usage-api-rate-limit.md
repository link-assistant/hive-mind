---
'@link-assistant/hive-mind': patch
---

Fix Claude Usage API rate limiting by increasing cache TTL to 20 minutes

- The Claude Usage API (`/api/oauth/usage`) was returning null values due to rate limiting when called too frequently
- Increased default cache TTL from 3 minutes to 20 minutes for Claude Usage API
- Added configurable environment variable `HIVE_MIND_USAGE_API_CACHE_TTL_MS` (default: 1200000ms = 20 minutes)
- Added HTTP response status logging for easier debugging
- Added explicit 429 rate limit error handling
- Updated documentation in `docs/CONFIGURATION.md`

See: https://github.com/link-assistant/hive-mind/issues/1074
