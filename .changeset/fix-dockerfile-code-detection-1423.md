---
'@link-assistant/hive-mind': patch
---

fix: configure release pipeline to react to docker=true so Dockerfile changes trigger Docker image rebuild (Issue #1423)

Previously, commits that changed only `Dockerfile` or `coolify/Dockerfile` produced `docker=true` but `code=false`. The `release` job required all test jobs to `succeed` — but those tests were correctly skipped (no JavaScript code changed). Since `skipped != 'success'`, the release job was also skipped, and no Docker image was rebuilt.

This was observed when PR #1420 (fixing `/home/hive/.config` ownership) was merged: both Dockerfiles changed, but CI run `23040959919` showed all Docker publish jobs as skipped.

The `release` job condition is now updated to:
- Also trigger when `docker-changed == 'true'` (not only `code=true`)
- Accept `skipped` as well as `success` for test/lint jobs (skipped = intentionally not run, not a failure)
- Block on any actual job `failure`

This directly configures CI/CD to react to `docker=true` — without misclassifying Dockerfiles as "code" files.

Full root cause analysis and timeline in `docs/case-studies/issue-1423/`.
