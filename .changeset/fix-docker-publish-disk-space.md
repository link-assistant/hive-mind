---
'@link-assistant/hive-mind': patch
---

Fix Docker publish jobs failing with "No space left on device" error

Added disk space cleanup step to both `docker-publish` and `docker-publish-instant` jobs in the release workflow. This step removes large pre-installed packages (dotnet, android SDK, GHC, CodeQL) and prunes unused Docker images before building multi-platform Docker images.

This fixes issue #975 where instant releases failed during arm64 build due to insufficient disk space when installing Rust toolchain.
