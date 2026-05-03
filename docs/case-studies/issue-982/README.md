# Case Study: Docker Multi-Platform Build Stuck/Timeout (Issue #982)

**Date**: 2025-12-24
**Issue**: [#982](https://github.com/link-assistant/hive-mind/issues/982)
**Pull Request**: [#983](https://github.com/link-assistant/hive-mind/pull/983)
**Status**: Investigating - QEMU emulation causing extreme slowdown

---

## Executive Summary

The Docker image publishing workflow (`docker-publish` job in `release.yml`) is stuck or extremely slow when attempting to build multi-platform images (linux/amd64 + linux/arm64). The workflow run [#20487143111](https://github.com/link-assistant/hive-mind/actions/runs/20487143111) has been running for over 3 hours on the "Build and push Docker image" step without completing.

**Root Cause**: Using QEMU emulation to build ARM64 images on x86_64 GitHub-hosted runners, combined with a complex Dockerfile (~1420 line installation script) that installs numerous development tools, results in extremely slow or stuck builds.

**Key Finding**: The docker-pr-check job completes successfully because it only builds for `linux/amd64` without QEMU emulation, while docker-publish uses QEMU to emulate ARM64, which is 10-100x slower.

---

## Problem Statement

### Symptom

GitHub Actions workflow run [#20487143111](https://github.com/link-assistant/hive-mind/actions/runs/20487143111) is stuck at the "Build and push Docker image" step in the "Docker Publish (Instant)" job for over 3 hours.

### Timeline

| Event                       | Time (UTC)          | Duration |
| --------------------------- | ------------------- | -------- |
| Workflow started            | 2025-12-24 13:24:18 | -        |
| Docker Publish job started  | ~13:24:30           | -        |
| Build and push step started | ~13:25:00           | -        |
| Issue reported              | 2025-12-24 ~13:30   | ~5 min   |
| Last observed               | 2025-12-24 16:18:00 | ~3 hours |

### Expected Behavior

The Docker image build and push should complete within 15-30 minutes for a multi-platform build.

---

## Data Collection

### Workflow Run Analysis

From GitHub CLI:

```json
{
  "databaseId": 20487143111,
  "conclusion": "",
  "status": "in_progress",
  "createdAt": "2025-12-24T13:24:18Z",
  "headSha": "acd8021ed02af027d6bf5df6814d84855f12b25a",
  "name": "Checks and release"
}
```

### Job Status

The stuck job "Docker Publish (Instant)" (ID: 58871801909) shows:

- ✓ Set up job
- ✓ Checkout repository
- ✓ Free up disk space
- ✓ Wait for NPM package availability
- ✓ Set up QEMU
- ✓ Set up Docker Buildx
- ✓ Log in to Docker Hub
- ✓ Extract metadata (tags, labels) for Docker
- \* **Build and push Docker image** ← STUCK HERE
- \* Verify published image
- \* Post steps pending

### Comparison: docker-pr-check vs docker-publish

| Aspect           | docker-pr-check    | docker-publish                |
| ---------------- | ------------------ | ----------------------------- |
| Build command    | `docker build`     | `docker/build-push-action@v5` |
| Platforms        | `linux/amd64` only | `linux/amd64,linux/arm64`     |
| QEMU usage       | No (native)        | Yes (for arm64)               |
| Typical duration | ~5-10 minutes      | ~15-30+ minutes (expected)    |
| Current status   | Works              | STUCK (3+ hours)              |

### Dockerfile Complexity

The Docker image uses `scripts/ubuntu-24-server-install.sh` (1420 lines) which installs:

- Node.js, npm, nvm
- Python, pyenv, pip
- Rust, cargo
- Go
- Java (SDKMAN)
- Homebrew
- PHP
- Deno
- Bun
- Playwright
- Lean/Lake
- Rocq/Coq (via opam)
- LLVM, Clang, CMake
- And many more tools

This extensive installation is the primary source of the build time.

---

## Root Cause Analysis

### Primary Root Cause: QEMU Emulation Performance

When building Docker images for a non-native architecture (ARM64 on x86_64 runners), QEMU must emulate the entire CPU architecture. This introduces:

1. **10-100x slowdown** compared to native builds
2. **Memory pressure** as QEMU manages emulated memory
3. **Potential hangs** during certain operations

### Evidence from Industry

From [docker/build-push-action#982](https://github.com/docker/build-push-action/issues/982):

> "A single platform build completed in ~7 minutes, while dual-platform builds exceeded one hour or timed out entirely."

From [docker/setup-qemu-action#22](https://github.com/docker/setup-qemu-action/issues/22):

> "Build time increased from 9 minutes to 69 minutes when using QEMU emulation."

From [Docker's Multi-platform documentation](https://docs.docker.com/build/ci/github-actions/multi-platform/):

> "Using QEMU emulation on x86-64 runners to build Arm64 images introduces performance overhead and potential compatibility issues."

### Contributing Factors

1. **Complex Dockerfile**: The 1420-line installation script performs many operations that are particularly slow under QEMU:
   - Compiling Rust crates
   - Building Python packages from source
   - Compiling native npm modules
   - Installing Lean/Lake toolchain

2. **No Build Caching for ARM64**: While GitHub Actions cache (`type=gha`) helps with amd64 builds, ARM64 builds start fresh each time.

3. **GitHub Runner Limitations**: GitHub-hosted runners have limited CPU and memory, which becomes a bottleneck when running QEMU.

### Impact

- **Releases blocked**: Docker images cannot be published
- **CI resources wasted**: Jobs run for hours before timing out (6-hour limit)
- **User impact**: Users cannot pull latest Docker images

---

## Proposed Solutions

### Solution 1: Matrix Strategy with Native ARM64 Runners (Recommended)

Use GitHub's native ARM64 runners to build platform-specific images in parallel, then merge manifests.

**Pros**:

- Native ARM64 builds are as fast as AMD64 builds
- No QEMU emulation overhead
- Parallel builds reduce total time

**Cons**:

- GitHub ARM64 runners may have different availability
- Requires workflow refactoring
- Manifest merging adds complexity

**Implementation**:

```yaml
docker-publish:
  strategy:
    fail-fast: false
    matrix:
      include:
        - platform: linux/amd64
          runner: ubuntu-latest
        - platform: linux/arm64
          runner: ubuntu-24.04-arm
  runs-on: ${{ matrix.runner }}
  steps:
    - name: Build and push by digest
      uses: docker/build-push-action@v5
      with:
        platforms: ${{ matrix.platform }}
        # ... outputs digests for later merging

# Separate job to merge manifests
docker-merge:
  needs: docker-publish
  steps:
    - name: Create and push manifest list
      run: |
        docker manifest create konard/hive-mind:${{ version }} \
          --amend konard/hive-mind@sha256:${{ amd64_digest }} \
          --amend konard/hive-mind@sha256:${{ arm64_digest }}
        docker manifest push konard/hive-mind:${{ version }}
```

### Solution 2: Separate ARM64 Build in Dedicated Job

Build ARM64 in a separate job with extended timeout, accepting longer build times.

**Pros**:

- Minimal workflow changes
- AMD64 publishes quickly, ARM64 follows later

**Cons**:

- ARM64 builds will still take 30-60+ minutes
- Risk of timeout (6-hour limit)
- Not a long-term solution

**Implementation**:

```yaml
docker-publish-amd64:
  # ... builds and pushes amd64 immediately

docker-publish-arm64:
  timeout-minutes: 120 # 2 hours
  # ... builds and pushes arm64 separately
```

### Solution 3: Remove ARM64 Support (Temporary Rollback)

Revert to amd64-only builds while evaluating long-term solutions.

**Pros**:

- Immediate fix for blocked releases
- Restores fast CI times

**Cons**:

- Apple Silicon and ARM Linux users cannot use Docker images
- Loses the work done in PR #963
- Not a real solution

**Implementation**:

```yaml
# In docker-publish job
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64 # Remove arm64
```

### Solution 4: Use Third-Party Native ARM64 Runners

Use services like Blacksmith, Buildjet, or self-hosted ARM64 runners.

**Pros**:

- Native ARM64 performance
- Works with existing workflow structure

**Cons**:

- Additional cost
- Third-party dependency
- May require configuration changes

---

## Recommendation

**Recommended Approach**: Implement **Solution 1** (Matrix Strategy with Native ARM64 Runners) as GitHub now provides native ARM64 runners (`ubuntu-24.04-arm`).

**Rationale**:

1. Native builds are 10-100x faster than QEMU emulation
2. No additional cost (using GitHub-hosted runners)
3. Industry-standard approach for multi-platform images
4. Eliminates risk of QEMU-related hangs

**Fallback**: If ARM64 runners have availability issues, implement **Solution 3** (temporary amd64-only) until a better solution is available.

---

## Implementation Plan

1. **Immediate**: Cancel stuck workflow run to free up resources
2. **Short-term**: Update `release.yml` to use matrix strategy with native runners
3. **Verify**: Test with a manual workflow dispatch
4. **Release**: Merge changes and publish Docker images

---

## References

### Internal Documentation

- [Issue #962 Case Study](../issue-962/README.md) - Multi-platform ARM64 support
- [Issue #975 Case Study](../issue-975/README.md) - Docker publish output issues
- [PR #963](https://github.com/link-assistant/hive-mind/pull/963) - Multi-platform build enabled
- [PR #980](https://github.com/link-assistant/hive-mind/pull/980) - Output passthrough fix

### External Resources

- [Docker Multi-platform CI/CD](https://docs.docker.com/build/ci/github-actions/multi-platform/)
- [GitHub Actions ARM64 Runners](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners#supported-runners-and-hardware-resources)
- [docker/build-push-action#982](https://github.com/docker/build-push-action/issues/982) - Multiplatform slowdown
- [docker/setup-qemu-action#22](https://github.com/docker/setup-qemu-action/issues/22) - QEMU performance
- [Building ARM64 Images in GitHub Actions](https://www.blacksmith.sh/blog/building-multi-platform-docker-images-for-arm64-in-github-actions)

---

## Appendix A: Stuck Run Logs

The logs from run #20487143111 are not available while the job is in progress. Once the job completes (or times out), logs will be captured in this directory.

## Appendix B: QEMU Performance Benchmarks

Expected performance ratios for QEMU emulation:

| Operation    | Native | QEMU   | Slowdown |
| ------------ | ------ | ------ | -------- |
| apt install  | 1x     | 3-5x   | 3-5x     |
| npm install  | 1x     | 5-10x  | 5-10x    |
| Rust compile | 1x     | 20-50x | 20-50x   |
| Go compile   | 1x     | 10-20x | 10-20x   |

Source: Community benchmarks from docker/buildx and docker/setup-qemu-action issues.
