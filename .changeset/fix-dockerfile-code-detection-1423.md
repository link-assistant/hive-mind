---
'@link-assistant/hive-mind': patch
---

fix: include Dockerfile changes in code detection to trigger Docker image rebuild (Issue #1423)

Previously, commits that changed only `Dockerfile` or `coolify/Dockerfile` produced `code=false` in `detect-code-changes.mjs` because the `codePattern` regex only matched files with extensions (`.mjs`, `.json`, `.yml`, `.yaml`) or workflow paths. Since `Dockerfile` has no extension, it was not matched as a "code change," causing all test jobs and the `release` job to be skipped — and consequently no Docker image was rebuilt or published.

This was observed when PR #1420 (fixing `/home/hive/.config` ownership) was merged: both Dockerfiles changed, but CI run `23040959919` showed all Docker publish jobs as skipped.

Now `Dockerfile`, `coolify/Dockerfile`, and `.dockerignore` are included in the `codePattern` regex, ensuring Dockerfile-only commits produce `code=true` and trigger the full test → release → Docker publish pipeline.

Full root cause analysis and timeline in `docs/case-studies/issue-1423/`.
