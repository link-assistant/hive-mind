---
'@link-assistant/hive-mind': patch
---

fix: set Docker image version labels to actual release version (Issue #1419)

The `docker/metadata-action@v5` defaulted the `org.opencontainers.image.version`
OCI label to the Git ref name `"main"` instead of the actual release version.
Added explicit `labels` override to all four Docker metadata steps in both regular
and instant release pipelines.

Also added `.config` directory ownership and write-access verification to the Docker
image verification script to prevent the permission regression from recurring.
