---
'@link-assistant/hive-mind': patch
---

fix: non-consistent auto-restart logic on comments (#1567)

- Reduce CI check interval from 5 minutes to 2 minutes for faster response times
- Prevent concurrent sessions on the same PR/issue via active session URL checking
- Add cross-process deduplication for "Ready to merge" comments
- Add initial 2-minute cooldown before first mergeable check to ensure proper ordering
