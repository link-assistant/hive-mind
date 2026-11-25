---
'@link-assistant/hive-mind': patch
---

Pass the full Docker isolation task image from `hive-manager deploy` as `HIVE_MIND_DOCKER_ISOLATION_IMAGE` instead of putting an image reference in `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`. The task image reuses the deployment image, pinned to its release tag when that tag is the same image. You can select it with `--task-image`, `task-image=` or the environment file, and it is the only image allowed through the dind host passthrough. A full reference left in the tag variable by older deployments is used as-is.
