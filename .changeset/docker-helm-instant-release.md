---
'@link-assistant/hive-mind': patch
---

fix: enable Docker and Helm publishing for instant releases

Previously, when using the "instant release" workflow (triggered via workflow_dispatch),
Docker images and Helm charts were not published because they only depended on the
`release` job outputs. This fix adds dedicated `docker-publish-instant` and
`helm-release-instant` jobs that depend on the `instant-release` job outputs.

This resolves the issue where Docker Hub images were 14 days behind npm releases.
