---
'@link-assistant/hive-mind': minor
---

Optimize Docker build by using pinned konard/sandbox version as base image

- Docker image now inherits from `konard/sandbox:1.3.16` (pinned) instead of building from scratch
- Significantly faster build times (2-3 min vs 10-15+ min) as general-purpose tools are pre-installed
- Reduced timeout risk since heavy installations (Homebrew, PHP, etc.) are handled by base image
- Removed `scripts/ubuntu-24-server-install.sh` (functionality now provided by sandbox)
- User renamed from `sandbox` to `hive` for backward compatibility
- Sandbox version is pinned to `1.3.16` for stable, reproducible builds (instead of `latest`)
- Docker image is versioned to match the published npm package version
- Docker builds are triggered only after npm package availability is confirmed

This change implements the separation of concerns described in link-foundation/sandbox#65:

- sandbox: Universal development environment with all general-purpose tools
- hive-mind: AI-specific tools (Claude CLI, Playwright MCP, etc.) built on top of sandbox
