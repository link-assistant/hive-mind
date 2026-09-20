# Case Study: Docker Image Not Supported on Apple Silicon (Issue #962)

**Date**: 2025-12-22
**Issue**: [#962](https://github.com/link-assistant/hive-mind/issues/962)
**Pull Requests**:

- [#963](https://github.com/link-assistant/hive-mind/pull/963) - Multi-platform build enabled (amd64 + arm64)
- [#966](https://github.com/link-assistant/hive-mind/pull/966) - Fix Sentry CLI breaking Docker publish
  **Status**: Investigating - Two issues identified

---

## Executive Summary

The Docker image `konard/hive-mind:latest` fails to pull on macOS with Apple Silicon (M1/M2/M3) processors because the image is built only for the `linux/amd64` architecture. Apple Silicon uses the ARM64 architecture (`linux/arm64/v8`), and when Docker attempts to pull an image without a matching platform manifest, it returns the error: "no matching manifest for linux/arm64/v8 in the manifest list entries."

**Critical Finding**: Investigation revealed **two separate but related issues**:

1. **Primary Issue (Blocking)**: Docker images have not been published since v0.38.1 (Dec 9, 2025) due to a broken Sentry CLI command in the release workflow. The `sentry-cli releases files` command was removed in Sentry CLI 3.x, causing the Release job to fail and skip Docker publishing.

2. **Secondary Issue (Configuration)**: Multi-platform ARM64 support was added in PR #963 but never took effect because Docker publishing was blocked by Issue #1.

**Current Gap**: 10+ releases (0.38.2 through 0.48.3) have npm packages but NO Docker images.

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

The current release workflow (`/.github/workflows/release.yml`) was updated in PR #963 to build for both architectures:

```yaml
# Line 1647-1657 in release.yml
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
    platforms: linux/amd64,linux/arm64 # <-- Both architectures configured
```

**However**, Docker images have not been published since Dec 9, 2025 (v0.38.1) due to the Sentry CLI issue.

### Release Gap Analysis

| Source          | Latest Version | Last Updated |
| --------------- | -------------- | ------------ |
| npm Registry    | 0.48.3         | 2025-12-22   |
| Docker Hub      | 0.38.1         | 2025-12-09   |
| GitHub Releases | v0.48.3        | 2025-12-22   |

**Missing Docker Images**: 0.38.2, 0.38.3, 0.38.4, 0.38.5, 0.38.6, 0.38.7, 0.38.8, 0.38.9, 0.39.0, 0.40.0, 0.40.1, 0.40.3, 0.41.0, 0.41.2, 0.41.3, 0.41.5, 0.41.7, 0.41.8, 0.41.9, 0.41.10, 0.42.0, 0.42.1, 0.42.2, 0.42.3, 0.43.0, 0.44.0, 0.45.0, 0.46.0, 0.46.1, 0.47.0, 0.47.1, 0.47.2, 0.48.0, 0.48.1, 0.48.2, 0.48.3

### Sentry CLI Error Analysis

The Release job fails at the "Post-publish - Upload Source Maps to Sentry" step:

```
error: unrecognized subcommand 'files'

Usage: sentry-cli releases [OPTIONS] <COMMAND>

For more information, try '--help'.
❌ Failed to upload source maps: Command failed: npx @sentry/cli releases files 0.48.3 upload-sourcemaps ./src --org deepassistant --project hive-mind --url-prefix '~/src'
```

This is caused by the `sentry-cli releases files` command being removed in Sentry CLI 3.x. The correct command is now `sentry-cli sourcemaps upload`.

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

### Primary Root Cause: Sentry CLI 3.x Breaking Change

The **immediate cause** of Docker images not being published is a breaking change in Sentry CLI 3.x.

The `scripts/upload-sourcemaps.mjs` file uses the deprecated command:

```javascript
// OLD (broken in Sentry CLI 3.x)
execSync(`npx @sentry/cli releases files ${version} upload-sourcemaps ./src ...`);
```

This was removed in Sentry CLI 3.x (see [Sentry CLI Releases](https://github.com/getsentry/sentry-cli/releases)). The new command is:

```javascript
// NEW (Sentry CLI 3.x compatible)
execSync(`npx @sentry/cli sourcemaps upload ./src --release ${version} ...`);
```

**Consequence**: When the Release job fails at Sentry sourcemap upload, the `docker-publish` job is skipped because it depends on `release.outputs.published == 'true'`, which is only set on successful release completion.

### Secondary Root Cause: Missing ARM64 Support (Historical)

Before PR #963, the Docker image was built exclusively for `linux/amd64` architecture. Apple Silicon Macs use ARM64 processors, which require images built for `linux/arm64/v8`.

This was **already fixed** in PR #963 by adding:

- QEMU setup for cross-platform emulation
- `platforms: linux/amd64,linux/arm64` to build both architectures

However, this fix never took effect because Docker publishing was blocked by the Sentry CLI issue.

### Contributing Factors

1. **Silent Failure Propagation**: The Sentry sourcemap upload step fails the Release job, but npm publish succeeds first. This creates a state where npm has the new version but Docker does not.

2. **Job Dependency Chain**: The workflow uses `needs: [release]` for docker-publish, meaning any failure in the release job blocks Docker publishing.

3. **No Alerting**: There was no alert or notification when Docker publishing stopped working. The issue was only discovered when a user tried to pull the image.

### Impact Assessment

- **13 days** without Docker image updates (Dec 9 - Dec 22, 2025)
- **36+ releases** published to npm without corresponding Docker images
- **All Apple Silicon users** affected (plus ARM-based Linux systems)

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

## Implementation

### Fix 1: Sentry CLI Update (PR #966)

The Sentry sourcemap upload script needs to be updated to use the new Sentry CLI 3.x command syntax.

**File**: `scripts/upload-sourcemaps.mjs`

**Before** (lines 62, 71):

```javascript
execSync(`npx @sentry/cli releases files ${version} upload-sourcemaps ./src --org ${orgName} --project ${projectName} --url-prefix '~/src'`, ...);
```

**After**:

```javascript
execSync(`npx @sentry/cli sourcemaps upload ./src --org ${orgName} --project ${projectName} --release ${version} --url-prefix '~/src'`, ...);
```

Reference: [Sentry CLI 3.x Release Notes](https://github.com/getsentry/sentry-cli/releases) - "The `releases files` command has been removed. Use `sourcemaps upload` instead."

### Fix 2: Multi-Platform Docker Builds (PR #963 - Already Merged)

The multi-platform build support was already added in PR [#963](https://github.com/link-assistant/hive-mind/pull/963):

**1. Docker Publish Job (`docker-publish`)**

Added QEMU setup and updated platforms:

```yaml
# Added before docker/setup-buildx-action
- name: Set up QEMU
  uses: docker/setup-qemu-action@v3

# Updated platforms parameter
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    # ... existing configuration ...
    platforms: linux/amd64,linux/arm64 # Previously: linux/amd64
```

**2. Docker PR Check Job (`docker-pr-check`)**

Added QEMU and Buildx setup for consistency, but only runs amd64 build to avoid disk space issues:

```yaml
- name: Set up QEMU
  uses: docker/setup-qemu-action@v3

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build Docker image with log capture (amd64)
  run: |
    # Note: Multi-platform builds (amd64+arm64) are tested in docker-publish job during release
    # PR checks only validate amd64 to avoid disk space issues on runners
    docker buildx build --progress=plain --platform linux/amd64 --load -t ${{ env.IMAGE_NAME }}:test .
```

Note: Full multi-platform builds are not run during PR checks because the Docker image
is very large (~6GB+ with all development tools), and building for both architectures
would exceed the GitHub runner disk space limits. The multi-platform build is tested
during the actual release in the `docker-publish` job.

### Expected Results After Merge

Once this PR is merged and a new release is published:

1. **Docker Hub images** will contain manifests for both `linux/amd64` and `linux/arm64`
2. **Apple Silicon users** can run `docker pull konard/hive-mind:latest` without errors
3. **ARM-based Linux systems** (Raspberry Pi, AWS Graviton) will also be supported

### Verification

After the next release, users can verify multi-platform support:

```bash
# Check manifest (should show both amd64 and arm64)
docker manifest inspect konard/hive-mind:latest

# Pull on Apple Silicon (should work without --platform flag)
docker pull konard/hive-mind:latest
```

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
