---
'@link-assistant/hive-mind': patch
---

Fix stuck Docker multi-platform builds by using native ARM64 runners

The Docker publish workflow was getting stuck for hours when building ARM64 images using QEMU emulation on x86_64 runners. QEMU emulation introduces 10-100x slowdown, especially for complex Dockerfiles that compile native packages.

**Solution**: Refactored docker-publish jobs to use GitHub's native ARM64 runners (`ubuntu-24.04-arm`) with a matrix strategy:

- Each platform (amd64, arm64) builds natively in parallel on dedicated runners
- Build artifacts (digests) are uploaded and merged into a multi-platform manifest
- Eliminates QEMU emulation overhead entirely
- Build times should now be similar for both platforms (~10-15 minutes each)

This fix applies to both:

- `docker-publish` job (triggered by regular releases)
- `docker-publish-instant` job (triggered by manual instant releases)

Fixes #982
