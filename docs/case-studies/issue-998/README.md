# Case Study: Docker Publish (linux/arm64) Is Stuck (Issue #998)

**Date**: 2025-12-25
**Issue**: [#998](https://github.com/link-assistant/hive-mind/issues/998)
**Pull Request**: [#999](https://github.com/link-assistant/hive-mind/pull/999)
**Status**: Investigating - ARM64 runner performance issues with Homebrew bottle downloads

---

## Executive Summary

The Docker image publishing workflow (`docker-publish` job in `release.yml`) is stuck during the "Build and push by digest" step for `linux/arm64` platform. The job has been running for over 1 hour 50 minutes, specifically stuck during Homebrew bottle downloads for PHP dependencies.

**Key Finding**: This is a **different issue** from #982. Issue #982 was caused by QEMU emulation and was fixed by PR #983 which switched to native ARM64 runners. The current issue (#998) occurs on native ARM64 runners (`ubuntu-24.04-arm`) and is related to **slow Homebrew bottle downloads** on ARM64 GitHub-hosted runners.

**Root Cause**: Multiple contributing factors:

1. Ubuntu 24.04 ARM runners have known network/download performance issues
2. Homebrew arm64 Linux bottles may have limited CDN availability
3. Docker commands are slower on ARM runners (documented in [partner-runner-images#101](https://github.com/actions/partner-runner-images/issues/101))
4. The installation script installs PHP via Homebrew, requiring many bottle downloads

---

## Problem Statement

### Symptom

GitHub Actions workflow run [#20506901536](https://github.com/link-assistant/hive-mind/actions/runs/20506901536/job/58922966646) has the `Docker Publish (linux/arm64)` job stuck at the "Build and push by digest" step for over 1 hour 50 minutes.

### Timeline

| Event                                  | Time (UTC)                 | Duration |
| -------------------------------------- | -------------------------- | -------- |
| Workflow started                       | 2025-12-25 15:00:18        | -        |
| detect-changes job completed           | 15:00:28                   | ~10s     |
| Release job completed                  | 15:06:30                   | ~6m      |
| Docker Publish (linux/arm64) started   | 15:06:38                   | -        |
| Build and push by digest started       | 15:07:02                   | -        |
| Docker Publish (linux/amd64) completed | 15:38:50                   | ~32m     |
| Issue reported                         | ~16:38:48 (1h 38m 30s ago) | -        |
| Last checked                           | 16:51:05                   | >1h 50m  |

### Screenshot Analysis

The screenshot shows the arm64 build stuck at step #10 (Build and push by digest) with:

- Line numbers around 3083-3107 showing Homebrew bottle downloads
- Packages being downloaded: `icu4c@78`, `libpq`, `libsodium`, `gmp`, `libzip`, `aspell`, `oniguruma`, `pcre2`, `tidy-html5`, `libxml2`, `libgpg-error`, `libgcrypt`, `libxslt`, `php@8.3`
- These are all PHP 8.3 dependencies from Homebrew

### Comparison: amd64 vs arm64

| Aspect           | Docker Publish (linux/amd64) | Docker Publish (linux/arm64) |
| ---------------- | ---------------------------- | ---------------------------- |
| Runner           | ubuntu-latest                | ubuntu-24.04-arm             |
| Build time       | ~32 minutes                  | >1h 50m (ongoing)            |
| Step stuck on    | N/A (completed)              | Build and push by digest     |
| Homebrew bottles | Downloaded successfully      | Downloading very slowly      |

---

## Data Collection

### Workflow Configuration

From `.github/workflows/release.yml` lines 1620-1703:

- Uses matrix strategy with native runners (no QEMU)
- `linux/amd64` uses `ubuntu-latest`
- `linux/arm64` uses `ubuntu-24.04-arm` (GitHub's ARM64 runner)
- Uses `docker/build-push-action@v5` with GHA caching

### Installation Script Analysis

From `scripts/ubuntu-24-server-install.sh` lines 929-1060:

- PHP is installed via Homebrew using `shivammathur/php` tap
- `brew install shivammathur/php/php@8.3` requires downloading ~15+ bottles
- Each bottle download depends on network speed and CDN availability

### Related Issues

1. **[actions/runner-images#11790](https://github.com/actions/runner-images/issues/11790)**: Ubuntu 24.04 CI runs taking 400%+ longer than Ubuntu 22.04
2. **[actions/partner-runner-images#101](https://github.com/actions/partner-runner-images/issues/101)**: Docker commands unexpectedly slow on Ubuntu ARM runners
3. **[Homebrew/brew#4579](https://github.com/Homebrew/brew/issues/4579)**: brew install download VERY slow
4. **[Homebrew/brew#19208](https://github.com/Homebrew/brew/issues/19208)**: ARM64 Linux support (beta in 2025)

---

## Root Cause Analysis

### Primary Root Cause: ARM64 Runner Performance Issues

The `ubuntu-24.04-arm` runner has multiple documented performance issues:

1. **Network Throughput**: ARM64 runners appear to have slower network performance for downloading packages
2. **Docker Version**: ARM runners have older Docker version (26.1.3) compared to x86 (28.0.4)
3. **Image Provider**: ARM64 images are provided by Arm Limited, not GitHub, with different infrastructure

### Secondary Root Cause: Homebrew ARM64 Linux Beta

From [Homebrew/brew#19208](https://github.com/Homebrew/brew/issues/19208):

- ARM64 Linux support is relatively new (beta announced in 2025)
- Bottle availability for ARM64 Linux may be limited
- CDN distribution for ARM64 bottles may be less optimized

### Contributing Factor: Complex Installation

The installation script installs ~25+ development tools including:

- PHP 8.3 via Homebrew (heaviest: requires many bottles)
- Python via pyenv (compiles from source)
- Rust via rustup
- Go (prebuilt binary)
- Java via SDKMAN
- Node.js via nvm
- Lean, Rocq/Coq, Perl, etc.

### Impact

- **Releases blocked**: Docker images cannot be published until arm64 build completes
- **CI time wasted**: Job runs for hours before potentially timing out (6-hour limit)
- **User impact**: Users on Apple Silicon or ARM Linux cannot pull native images

---

## Proposed Solutions

### Solution 1: Add Build Timeout with Retry (Short-term)

Add a reasonable timeout to the arm64 build and implement retry logic.

**Pros**:

- Prevents indefinite hangs
- Allows automatic retry on transient issues

**Cons**:

- Doesn't solve the underlying performance issue
- May still fail consistently

**Implementation**:

```yaml
docker-publish:
  timeout-minutes: 90 # 1.5 hours max
  # ... existing config
```

### Solution 2: Pre-build Base Image (Recommended)

Create a pre-built base image with all tools installed, then use it as the build base.

**Pros**:

- Eliminates slow package downloads during build
- Both amd64 and arm64 builds become fast
- Can be updated on a schedule (e.g., weekly)

**Cons**:

- Requires maintaining an additional image
- More complex CI pipeline
- Base image may become stale

**Implementation**:

1. Create `Dockerfile.base` with all tool installations
2. Build and push base image separately (can run overnight)
3. Use base image in main Dockerfile: `FROM konard/hive-mind-base:latest`

### Solution 3: Remove PHP from Docker Image

PHP is installed via Homebrew and is the heaviest component causing the slowdown.

**Pros**:

- Immediately fixes the slow build issue
- Reduces image size
- Simplifies installation script

**Cons**:

- Breaks PHP support for users who need it
- Removes functionality

**Implementation**:

```bash
# In ubuntu-24-server-install.sh, comment out PHP installation
# Lines 929-1060
```

### Solution 4: Use ubuntu-22.04-arm Instead

Some users report better performance on Ubuntu 22.04 ARM runners.

**Pros**:

- May have better network performance
- Still uses native ARM64 (no QEMU)

**Cons**:

- Older Ubuntu version
- May have different tool compatibility
- Temporary workaround

**Implementation**:

```yaml
matrix:
  include:
    - platform: linux/arm64
      runner: ubuntu-22.04-arm # Changed from ubuntu-24.04-arm
```

### Solution 5: Parallel Base Tool Installation with Caching

Optimize the installation script to use parallel downloads and better caching.

**Pros**:

- Improves build times incrementally
- No major architectural changes

**Cons**:

- Complex to implement correctly
- May not be significant enough improvement

---

## Recommendation

**Recommended Approach**: Implement **Solution 2** (Pre-build Base Image) combined with **Solution 1** (Build Timeout).

**Immediate Action**:

1. Add timeout to arm64 build (Solution 1) to prevent indefinite hangs
2. Cancel the currently stuck workflow run

**Short-term**:

1. Create a base image build workflow that runs weekly
2. Push base images for both amd64 and arm64
3. Update main Dockerfile to use base image

**Rationale**:

1. Separates slow package installation from fast app deployment
2. Base image builds can run overnight/weekly without blocking releases
3. Main builds become fast (seconds instead of hours)
4. Industry-standard approach for complex Docker images

---

## Implementation Plan

1. **Immediate**: Cancel stuck workflow run #20506901536
2. **PR #999**: Add build timeout and case study documentation
3. **Future PR**: Implement base image solution

---

## References

### Internal Documentation

- [Issue #982 Case Study](../issue-982/README.md) - QEMU emulation issue (different root cause)
- [PR #983](https://github.com/link-assistant/hive-mind/pull/983) - Native ARM64 runners fix

### External Resources

- [GitHub Actions ARM64 Runners](https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/)
- [actions/runner-images#11790](https://github.com/actions/runner-images/issues/11790) - Ubuntu 24.04 slowness
- [actions/partner-runner-images#101](https://github.com/actions/partner-runner-images/issues/101) - ARM Docker slowness
- [Homebrew ARM64 Linux Support](https://github.com/Homebrew/brew/issues/19208)
- [Building ARM64 Images Guide](https://www.blacksmith.sh/blog/building-multi-platform-docker-images-for-arm64-in-github-actions)

---

## Appendix A: Screenshot Analysis

The screenshot (`screenshots/issue-screenshot.png`) shows:

- Job: Docker Publish (linux/arm64)
- Started: 1h 37m 57s ago (at time of screenshot)
- Step: Build and push by digest - 1h 37m 33s elapsed
- Log lines 3083-3107 showing Homebrew bottle downloads
- Bottles for PHP dependencies being downloaded very slowly

## Appendix B: Workflow Run Data

```json
{
  "databaseId": 20506901536,
  "conclusion": "",
  "status": "in_progress",
  "createdAt": "2025-12-25T15:00:18Z",
  "headSha": "3467a36c0af2794cc6c80daaeb3699c5aa1e8d72",
  "headBranch": "main",
  "event": "push"
}
```

## Appendix C: ARM64 Job Details

```json
{
  "name": "Docker Publish (linux/arm64)",
  "databaseId": 58922966646,
  "status": "in_progress",
  "startedAt": "2025-12-25T15:06:38Z",
  "runner": "ubuntu-24.04-arm"
}
```
