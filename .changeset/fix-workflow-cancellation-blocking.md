---
'@link-assistant/hive-mind': patch
---

Fix workflow cancellation blocking by replacing always() with !cancelled() in Docker jobs (Issue #1278)

- Replace `always()` with `!cancelled()` in all Docker publish and Helm release job conditions
- Allow concurrency cancellation to properly interrupt Docker builds when new commits are pushed
- Reduce Docker job timeout from 60 to 30 minutes to minimize blocking time
- Fix issue where PR merges to main branch did not trigger releases due to stuck workflow runs
