---
'@link-assistant/hive-mind': patch
---

Fix Docker CI/CD amd64 build cancellation due to GHA cache export timeout

- Increase `timeout-minutes` from 30 to 45 in `docker-publish` and `docker-publish-instant` jobs
- Switch GHA cache mode from `mode=max` to `mode=min` to reduce sequential cache export payload
- Add `ignore-error=true` to `cache-to` so cache export failure does not cancel a successful image push
- Add comprehensive case study in `docs/case-studies/issue-1394/CASE-STUDY.md` with root cause analysis and CI log data

Root cause: The sandbox-based hive-mind image (~2-3 GB) takes ~30 min to build and push to Docker Hub.
After the push, BuildKit exports all image layers sequentially to GHA cache (`mode=max`). This sequential
write of ~800 MB per layer exhausted the 30-minute job timeout mid-export, cancelling an already-successful
build. The Docker image itself was published correctly; only the cache export step was interrupted.
