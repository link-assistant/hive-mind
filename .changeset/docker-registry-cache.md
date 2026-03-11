---
"@link-assistant/hive-mind": patch
---

Switch Docker builds to registry cache for faster arm64 builds

- Changed from GitHub Actions cache to Docker Hub registry cache backend
- Use architecture-specific cache tags (buildcache-amd64, buildcache-arm64) to prevent cross-platform cache overwriting
- Increased Docker job timeout from 45 to 60 minutes for safety margin
- Added comprehensive case study documentation for issue #1415
