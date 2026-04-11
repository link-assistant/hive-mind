---
'@link-assistant/hive-mind': patch
---

fix: prevent push failures in auto-restart and cleanup by syncing with remote (#1572)

- Add `git pull` before restart sessions and cleanup push to prevent stale local state
- Add `2>&1` to all `git push` commands so stderr is captured for proper error handling
- Fix multi-line log message formatting to include timestamps on each line
