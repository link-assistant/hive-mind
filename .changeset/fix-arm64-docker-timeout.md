---
'@link-assistant/hive-mind': patch
---

fix(ci): Add timeout, verbose diagnostics, and pre-fetch caching for Docker ARM64 builds

Addresses issue #998 where Docker Publish (linux/arm64) was stuck for >1.5 hours due to slow Homebrew bottle downloads on GitHub's ARM64 runners.

Changes:

- Added 90-minute timeout to docker-publish jobs to prevent indefinite hangs
- Switched from ubuntu-24.04-arm to ubuntu-22.04-arm for better network performance
- Added documentation comments about known ARM64 runner issues
- Added Homebrew verbose mode (`HOMEBREW_VERBOSE=1`) for detailed diagnostics
- Added `brew fetch --deps --retry` to pre-download bottles before installation
- Added timing measurements for fetch and install steps
- Updated case study with diagnostic approach

Root cause: GitHub's ubuntu-24.04-arm runners have known network performance issues (actions/runner-images#11790, actions/partner-runner-images#101). The ARM64 build was stuck downloading Homebrew bottles for PHP dependencies at extremely slow speeds.

See docs/case-studies/issue-998/README.md for detailed analysis.
