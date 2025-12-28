# Case Study: Issue #975 - Docker Hub Release Trigger Fix

## Issue Summary

We had no way to trigger Docker Hub release after making fixes in CI workflows. The instant release triggered manually failed to publish Docker images.

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/975
**Docker Hub:** https://hub.docker.com/r/konard/hive-mind

## Timeline of Events

### 2025-12-23 22:33 - Push to main with release.yml changes

- **CI Run:** https://github.com/link-assistant/hive-mind/actions/runs/20473095977
- **Commit SHA:** e34f6347674a9099d0622f2f3b4a0870821daa82
- **Changed files:**
  - `.changeset/docker-helm-instant-release.md`
  - `.github/workflows/release.yml`
  - `docs/case-studies/issue-975/README.md`
  - `scripts/helm-release.mjs`
  - `scripts/wait-for-npm.mjs`
- **Outcome:** CI passed, but Docker Publish was NOT triggered

### 2025-12-23 22:49 - Manual instant release triggered

- **CI Run:** https://github.com/link-assistant/hive-mind/actions/runs/20473342688
- **Trigger:** `workflow_dispatch` with `release_mode: instant`
- **Outcome:** FAILED with "No space left on device" error during arm64 build

## Root Cause Analysis

### Issue 1: Docker Publish Not Triggered on Workflow Changes

**Observation:** When `.github/workflows/release.yml` was changed, the Docker Publish step was skipped.

**Root Cause:** This is **expected behavior**, not a bug:

- The `docker-publish` job has condition: `if: needs.release.outputs.published == 'true'`
- Docker Publish only runs when an actual npm release occurs (via changesets)
- A commit that only changes workflow files doesn't trigger a new npm release
- Therefore, Docker isn't published on workflow-only changes

**Solution:** This behavior is intentional. Docker images are tied to npm version releases to ensure version consistency across npm, Docker Hub, and Helm charts.

### Issue 2: Instant Release Failed with Disk Space Error

**Observation:** The manual instant release job `docker-publish-instant` failed at line 19158:

```
#15 3029.3 error: failed to extract package: No space left on device (os error 28)
```

The error occurred during Rust installation in the arm64 emulated build.

**Root Cause:**

- The `docker-publish-instant` job was missing the "Free up disk space" step
- Multi-platform Docker builds (amd64 + arm64) require significant disk space
- When building for arm64 architecture via QEMU emulation, Rust toolchain installation requires ~2GB+
- GitHub Actions runners have limited disk space (~14GB), which fills up during multi-platform builds

**Evidence from logs:**

```
Disk space after cleanup: 17GB (docker-pr-check with cleanup)
vs
No cleanup step in docker-publish-instant (failed at arm64 Rust install)
```

## Solution Applied

Added "Free up disk space" step to both `docker-publish` and `docker-publish-instant` jobs:

```yaml
- name: Free up disk space
  run: |
    echo "Disk space before cleanup:"
    df -h /
    echo ""
    echo "Removing unnecessary packages to free disk space..."
    # Remove large pre-installed packages that we don't need
    sudo rm -rf /usr/share/dotnet
    sudo rm -rf /usr/local/lib/android
    sudo rm -rf /opt/ghc
    sudo rm -rf /opt/hostedtoolcache/CodeQL
    sudo docker image prune --all --force
    echo ""
    echo "Disk space after cleanup:"
    df -h /
```

This step was already present in `docker-pr-check` but was missing from the actual publishing jobs.

## Files Changed

- `.github/workflows/release.yml` - Added disk cleanup step to both Docker publishing jobs

## Log Files

Full CI logs can be accessed via GitHub Actions:

- Push run: https://github.com/link-assistant/hive-mind/actions/runs/20473095977
- Instant release run: https://github.com/link-assistant/hive-mind/actions/runs/20473342688

Key error summary from the failed instant release is preserved in `error-summary.txt`.

## Testing

After this fix is applied, manual instant releases via `workflow_dispatch` should successfully build and push multi-platform Docker images to Docker Hub.

## Lessons Learned

1. **Multi-platform Docker builds need disk space cleanup** - Building for multiple architectures (amd64 + arm64) via QEMU emulation requires significant disk space, especially when installing large toolchains like Rust.

2. **Keep publishing jobs consistent with PR checks** - If a PR check job has certain prerequisites (like disk cleanup), the actual publishing jobs should have the same prerequisites.

3. **Docker releases are tied to npm releases** - The current architecture publishes Docker images only on npm version releases to ensure version consistency across distribution channels.
