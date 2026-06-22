---
"@link-assistant/hive-mind": minor
---

Support and document both DooD (Docker-out-of-Docker) and DinD (Docker-in-Docker) docker-isolation workflows (#1962).

The isolation runner now resolves an explicit isolation **mode** from `HIVE_MIND_DOCKER_ISOLATION_MODE` (`dind`/`dood`) and infers it from the `DIND_SKIP_DAEMON` / `DOCKER_HOST` signals, defaulting to `dind` so existing deployments are unchanged. The startup preflight and verbose launch diagnostics adapt their wording per mode: in DooD they describe the **host** daemon and concrete-tag remediation (`docker pull <exact tag>` on the host, pin `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`) and no longer false-warn about a nested daemon or host-image passthrough that does not exist in DooD. DooD lets disk-constrained hosts reuse the host's copy of the multi-GB image with zero copy / zero pull / zero extra disk.

New docs page `docs/DOCKER-ISOLATION.md` (+ zh/hi/ru) covers the DinD-vs-DooD trade-off, both run recipes, the `--group-add <host-docker-gid>` socket requirement, the concrete-tag requirement, and how to verify image reuse; `docs/DOCKER.md` (+ zh/hi/ru) gains a DinD-vs-DooD deploy subsection recommending DooD where disk is tight.
