# Case Study: Docker Image Not Supported on Apple Silicon (Issue #962)

**Date**: 2025-12-22
**Issue**: [#962](https://github.com/link-assistant/hive-mind/issues/962)
**Pull Request**: [#963](https://github.com/link-assistant/hive-mind/pull/963)
**Status**: Analysis Complete - Multi-platform build recommended

---

## Executive Summary

The Docker image `konard/hive-mind:latest` fails to pull on macOS with Apple Silicon (M1/M2/M3) processors because the image is built only for the `linux/amd64` architecture. Apple Silicon uses the ARM64 architecture (`linux/arm64/v8`), and when Docker attempts to pull an image without a matching platform manifest, it returns the error: "no matching manifest for linux/arm64/v8 in the manifest list entries."

This is a **configuration limitation**, not a bug in the code. The solution is to enable multi-platform builds in the CI/CD pipeline.

---

## Problem Statement

### Symptom

When attempting to pull the Docker image on macOS with Apple Silicon:

```bash
konard@MacBook-Pro-Konstantin ~ % docker pull konard/hive-mind:latest
Error response from daemon: no matching manifest for linux/arm64/v8 in the manifest list entries: no match for platform in manifest: not found
```

### Expected Behavior

The Docker image should pull successfully on both Intel-based systems (amd64) and Apple Silicon systems (arm64).

---

## Data Collection

### Docker Hub Manifest Analysis

Inspecting the available tags on Docker Hub reveals that all published images only support `amd64`:

| Tag     | Architectures  |
| ------- | -------------- |
| latest  | amd64, unknown |
| 0.38.1  | amd64, unknown |
| 0.38.0  | amd64, unknown |
| 0.37.28 | amd64, unknown |
| 0.37.27 | amd64, unknown |
| 0.37.26 | amd64, unknown |
| 0.37.25 | amd64, unknown |
| 0.37.24 | amd64, unknown |
| 0.37.23 | amd64, unknown |
| 0.37.22 | amd64, unknown |

**Source**: Docker Hub API at `https://hub.docker.com/v2/repositories/konard/hive-mind/tags`

### CI/CD Configuration Analysis

The current release workflow (`/.github/workflows/release.yml`) explicitly builds for `linux/amd64` only:

```yaml
# Line 1619-1629 in release.yml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: .
    file: ./Dockerfile
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    labels: ${{ steps.meta.outputs.labels }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
    platforms: linux/amd64 # <-- Only AMD64 is built
```

---

## Timeline of Events

### Initial Docker Setup (September 2025)

**Commit**: `9e71c3b` - "Dockerize solve.mjs with credential transfer support"

- First Docker support added to the project
- Used `.gitpod.Dockerfile` as base
- Created `docker-compose.yml`, `docker-solve.sh`, and `DOCKER.md`
- No platform specification (defaulted to runner's architecture)

### Production Docker Image (November 2025)

**Commit**: `a8c17de` - "Add Docker support with Ubuntu 24.04 and CI/CD pipeline"

- Created `Dockerfile.production` with Ubuntu 24.04 base
- Added GitHub Actions workflow for Docker Hub publishing
- **No `platforms` parameter specified** - builds defaulted to `linux/amd64` (GitHub runner architecture)

### Workflow Consolidation (December 2025)

**Commit**: `0297bc4` - "Merge Docker and Helm releases into main workflow"

- Docker publish moved to `main.yml`
- `platforms: linux/amd64` explicitly added to workflow

**Commit**: `40545f6` - "Consolidate CI/CD to single release.yml following template best practices"

- All workflows consolidated into `release.yml`
- `platforms: linux/amd64` preserved

### Issue Reported (December 2025)

**Issue**: [#962](https://github.com/link-assistant/hive-mind/issues/962)

- User attempted `docker pull konard/hive-mind:latest` on macOS with Apple Silicon
- Received "no matching manifest for linux/arm64/v8" error
- Questioned whether this is a bug in code or system configuration

---

## Root Cause Analysis

### Primary Root Cause

The Docker image is built exclusively for `linux/amd64` architecture. Apple Silicon Macs use ARM64 processors, which require images built for `linux/arm64/v8` (or a multi-architecture manifest that includes ARM64).

### Contributing Factors

1. **Default GitHub Actions Runners**: Ubuntu runners on GitHub Actions are `x86_64` (amd64), so builds without explicit platform specification only produce amd64 images.

2. **Explicit Single-Platform Configuration**: The workflow explicitly specifies `platforms: linux/amd64`, which prevents multi-platform builds.

3. **No QEMU/Buildx Multi-Platform Setup**: The workflow uses `docker/setup-buildx-action@v3` but doesn't use `docker/setup-qemu-action@v3` for cross-platform emulation.

4. **Historical Design Decision**: Docker support was initially designed for server deployments (typically Intel-based), with local development on macOS as a secondary use case.

### Why This Wasn't a Bug in Code

This is a **CI/CD configuration limitation**, not a code bug:

- The Dockerfile itself is architecture-agnostic
- The base image (`ubuntu:24.04`) supports multi-architecture
- All installed tools (Node.js, Homebrew, etc.) are available for ARM64
- The limitation is purely in how the image is built and published

---

## Technical Analysis

### Docker Multi-Architecture Fundamentals

Docker uses **manifest lists** to support multiple architectures. A manifest list is a collection of architecture-specific image manifests:

```
konard/hive-mind:latest (manifest list)
├── linux/amd64 (image manifest) ← Currently the only entry
├── linux/arm64/v8 (image manifest) ← Missing, causes the error
├── linux/arm/v7 (image manifest) ← Optional for 32-bit ARM
└── ...
```

When you run `docker pull`, the Docker daemon:

1. Fetches the manifest list for the tag
2. Looks for a manifest matching the local architecture
3. Pulls that specific image

If no matching manifest exists, the error "no matching manifest" occurs.

### Current Build Process

```
┌─────────────────────┐
│  GitHub Actions     │
│  (ubuntu-latest)    │
│  Architecture:      │
│  x86_64/amd64       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  docker/buildx      │
│  platforms:         │
│  linux/amd64        │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Docker Hub         │
│  konard/hive-mind   │
│  Only amd64 images  │
└─────────────────────┘
```

### Required Changes for Multi-Platform Support

```
┌─────────────────────┐
│  GitHub Actions     │
│  (ubuntu-latest)    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  QEMU Emulation     │  ← NEW: Enables ARM builds on x86 runners
│  docker/setup-qemu  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  docker/buildx      │
│  platforms:         │
│  linux/amd64,       │  ← UPDATED: Both platforms
│  linux/arm64        │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Docker Hub         │
│  konard/hive-mind   │
│  amd64 + arm64      │  ← Multi-arch manifest
└─────────────────────┘
```

---

## Proposed Solutions

### Solution 1: Enable Multi-Platform Builds with QEMU (Recommended)

**Pros**:

- Works with existing GitHub-hosted runners (no infrastructure changes)
- Single workflow produces both architectures
- Industry-standard approach used by major projects

**Cons**:

- ARM builds through QEMU emulation are slower (2-10x)
- Build times will increase (current ~5-10min may become ~15-30min)

**Implementation**:

```yaml
# In docker-publish job of release.yml

# Add QEMU setup step before Docker Buildx
- name: Set up QEMU
  uses: docker/setup-qemu-action@v3

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

# Update build-push-action
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: .
    file: ./Dockerfile
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    labels: ${{ steps.meta.outputs.labels }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
    platforms: linux/amd64,linux/arm64 # <-- Add arm64
```

### Solution 2: Matrix Build with Native ARM Runner

**Pros**:

- Native ARM builds are 10-30x faster than QEMU emulation
- Build times remain similar to current single-platform builds

**Cons**:

- Requires ARM runner availability (GitHub now offers `ubuntu-24.04-arm`)
- More complex workflow with matrix strategy
- May incur additional costs depending on runner availability

**Implementation**:

```yaml
docker-publish:
  strategy:
    matrix:
      include:
        - platform: linux/amd64
          runner: ubuntu-latest
        - platform: linux/arm64
          runner: ubuntu-24.04-arm
  runs-on: ${{ matrix.runner }}
  # ... build each platform natively, then merge manifests
```

### Solution 3: User Workaround (No CI Changes)

For users who need immediate access without waiting for CI changes:

**Option A: Enable Rosetta 2 Emulation in Docker Desktop**

1. Open Docker Desktop on macOS
2. Go to Settings → Features in Development
3. Enable "Use Rosetta for x86/amd64 emulation on Apple Silicon"
4. Click Apply & Restart

**Option B: Force AMD64 Platform**

```bash
docker pull --platform linux/amd64 konard/hive-mind:latest
```

This pulls the AMD64 image and runs it through emulation. Performance will be reduced but functional.

**Option C: Build Locally**

```bash
git clone https://github.com/link-assistant/hive-mind.git
cd hive-mind
docker build -t hive-mind:local .
```

Building locally on Apple Silicon will produce a native ARM64 image.

---

## Recommendation

**Primary Recommendation**: Implement **Solution 1** (QEMU-based multi-platform builds).

**Rationale**:

1. **Simplicity**: Minimal workflow changes required
2. **Compatibility**: Works with existing GitHub-hosted runners
3. **Cost**: No additional infrastructure or runner costs
4. **Maintainability**: Single build produces both architectures
5. **Industry Standard**: Used by most major Docker projects

**Secondary Recommendation**: Document **Solution 3** (user workarounds) in `docs/DOCKER.md` as an immediate mitigation for users on Apple Silicon.

---

## Impact Assessment

### Users Affected

- All macOS users with Apple Silicon (M1, M2, M3, M4 chips)
- Estimated ~50% of macOS developer community (based on Apple Silicon adoption since 2020)
- Users running ARM-based Linux systems (Raspberry Pi, AWS Graviton, etc.)

### Build Time Impact

Enabling multi-platform builds will increase CI build times:

- **Current**: ~5-10 minutes for single-platform
- **With QEMU**: ~15-30 minutes for dual-platform
- **With Matrix**: ~10-15 minutes per platform (parallel)

### Testing Requirements

Multi-platform builds should include verification:

1. Pull test on AMD64 system
2. Pull test on ARM64 system (or emulation)
3. Basic functionality test on both platforms

---

## References

### Internal Documentation

- [DOCKER.md](../../../docs/DOCKER.md) - Docker usage documentation
- [release.yml](../../../.github/workflows/release.yml) - CI/CD workflow

### External Resources

- [Docker Multi-platform Image Builds](https://docs.docker.com/build/building/multi-platform/)
- [GitHub Actions: Building Multi-Platform Docker Images](https://docs.docker.com/build/ci/github-actions/multi-platform/)
- [Building Multi-Platform Docker Images for ARM64 in GitHub Actions](https://www.blacksmith.sh/blog/building-multi-platform-docker-images-for-arm64-in-github-actions)
- [Docker Buildx: Build Multi-Platform Images Like a Pro](https://dev.to/marufsarker/docker-buildx-build-multi-platform-images-like-a-pro-31hn)
- [How to Specify Platform for Pulling Images](https://www.codestudy.net/blog/change-platform-for-kubernetes-when-pulling-image/)

### Related Issues and Discussions

- [Docker Forum: Manifest lists linux/arm64](https://forums.docker.com/t/manifest-lists-linux-arm64-but-no-matching-manifest-for-linux-arm64-exists-in-the-manifest-list-entries/133173)
- [Foundry Docker ARM64 Issue #7680](https://github.com/foundry-rs/foundry/issues/7680)
- [Netflix Conductor Docker ARM64 Issue #2975](https://github.com/Netflix/conductor/issues/2975)
- [Apache Superset ARM64 Issue #25434](https://github.com/apache/superset/issues/25434)

---

## Appendix A: Error Message Analysis

The error message contains valuable diagnostic information:

```
Error response from daemon: no matching manifest for linux/arm64/v8 in the manifest list entries: no match for platform in manifest: not found
```

| Component               | Meaning                                                |
| ----------------------- | ------------------------------------------------------ |
| `Error response`        | Docker daemon is responding to a client request        |
| `no matching manifest`  | The requested architecture wasn't found                |
| `linux/arm64/v8`        | The architecture the client is running (Apple Silicon) |
| `manifest list entries` | The list of supported architectures in the image       |
| `no match for platform` | Final confirmation: platform mismatch                  |

---

## Appendix B: Docker Hub Tag Architecture Details

Data retrieved from Docker Hub API:

```json
{
  "name": "latest",
  "images": [
    {
      "architecture": "amd64",
      "os": "linux",
      "digest": "sha256:..."
    }
  ]
}
```

Note: Only `amd64` is present in the manifest. No `arm64` entry exists.

---

## Appendix C: Verification Commands

### Check Image Manifest (if Docker is available)

```bash
docker manifest inspect konard/hive-mind:latest
```

### Check Local Architecture

```bash
# On macOS
uname -m  # Returns "arm64" for Apple Silicon

# On Linux
dpkg --print-architecture  # Returns "amd64" or "arm64"
```

### Test Pull with Explicit Platform

```bash
# Force AMD64 (works with emulation on Apple Silicon)
docker pull --platform linux/amd64 konard/hive-mind:latest

# Request ARM64 (will fail until multi-platform is enabled)
docker pull --platform linux/arm64 konard/hive-mind:latest
```
