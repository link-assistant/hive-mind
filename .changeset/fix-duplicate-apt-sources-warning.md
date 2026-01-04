---
'@link-assistant/hive-mind': patch
---

Fix duplicate APT sources warning in installation script

- Add `cleanup_duplicate_apt_sources()` function to detect and remove duplicate APT source files
- Clean up duplicate Microsoft Edge sources (`microsoft-edge.list` vs `microsoft-edge-stable.list`)
- Clean up duplicate Google Chrome sources (`google-chrome.list` vs `google-chrome-stable.list`)
- Run cleanup before `apt update` to prevent "Target Packages configured multiple times" warnings
- Ensures script supports clean upgrade mode when run on previously installed systems
