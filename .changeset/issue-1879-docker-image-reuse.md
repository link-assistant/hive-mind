---
"@link-assistant/hive-mind": patch
---

Docker isolation: reuse the host image instead of re-downloading a copy inside the (nested) Docker daemon (#1879).

- src/isolation-runner.lib.mjs: add `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` to pin the
  isolation image tag, and `HIVE_MIND_DOCKER_ISOLATION_PULL` (always|missing|never) to emit a
  `docker run --pull` policy. Verbose mode now logs the resolved image and pull policy.
- scripts/preload-dind-isolation-image.mjs: seed a DinD container's nested daemon from the
  host (`docker save | docker exec -i … docker load`) so isolated tasks reuse the host image.
- .env.example: document the Docker isolation image/pull controls.
- Dockerfile / Dockerfile.dind / coolify/Dockerfile: bump the box base images to
  `konard/box:2.2.0` / `konard/box-dind:2.2.0` (and the `docs/UBUNTU-SERVER*.md` examples).
  v2.2.0 ships box's native host-image passthrough (box#94/#95), so the DinD deployment can seed
  the nested daemon from the host automatically with
  `-v /var/run/docker.sock:/var/run/host-docker.sock:ro -e DIND_HOST_PASSTHROUGH=public`.
- tests/test-issue-1879-docker-image-reuse.mjs: regression coverage.
- docs/case-studies/issue-1879: deep case study with logs, timeline, root causes, and runbook;
  records that box#94 shipped in v2.2.0 and reports two upstream follow-ups — box#96
  (public-mode passthrough test false positive) and box#97 (per-repository passthrough allowlist).
