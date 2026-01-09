---
'@link-assistant/hive-mind': patch
---

Remove QEMU from CI/CD entirely

- Remove unnecessary QEMU and Docker Buildx setup from docker-pr-check job
- The PR check only builds for linux/amd64, so QEMU was never needed
- docker-publish jobs already use native ARM64 runners (ubuntu-24.04-arm)
- This addresses feedback to remove QEMU from CI/CD to avoid slowdowns and freezes
