---
'@link-assistant/hive-mind': patch
---

Add Playwright browser verification to installation script and CI

- Enhanced `scripts/ubuntu-24-server-install.sh` with detailed browser verification after installation
- Added CI checks in `.github/workflows/release.yml` to verify required Playwright browsers (chromium, firefox, webkit) are installed
- CI now fails if required browsers are missing, ensuring Playwright MCP server has all dependencies
